/**
 * media-hub-cdn — Cloudflare Worker
 *
 * Rota: cdn.digital-ai.tech/media-hub/*
 *
 * Responsabilidades:
 *  - Valida cookie HMAC-SHA256 (mh_access_token) para todos os requests a /media-hub/*
 *  - Injeta header secreto ao buscar no S3 (satisfaz bucket policy Deny sem Referer)
 *  - Serve com headers de cache otimizados por tipo de arquivo
 *  - Pass-through transparente para qualquer path fora de /media-hub/*
 *
 * Secrets (configurar via: wrangler secret put <NOME>):
 *  - MH_TOKEN_SECRET  → mesmo valor que na API (HMAC compartilhado)
 *  - CF_S3_SECRET     → URL-like string presente na S3 bucket policy (Referer)
 *  - S3_BUCKET_DOMAIN → ex: cdn.digital-ai.tech.s3.amazonaws.com
 *
 * Deploy:
 *  wrangler deploy
 *
 * Rota configurada em wrangler.toml:
 *  pattern = "cdn.digital-ai.tech/media-hub/*"
 */

const MEDIA_HUB_PREFIX = '/media-hub/';

// TTLs de cache por extensão (segundos)
const CACHE_TTL = {
  m3u8:    5,       // playlists HLS — curto pois podem mudar durante processamento
  ts:      86400,   // segmentos HLS — imutáveis após processamento
  webp:    86400,   // thumbnails — imutáveis
  mp4:     3600,    // raw video
  default: 300,
};

function getCacheTtl(pathname) {
  const ext = pathname.split('.').pop()?.toLowerCase();
  return CACHE_TTL[ext] ?? CACHE_TTL.default;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.substring(0, idx).trim();
    const value = part.substring(idx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (isNaN(byte)) return null;
    bytes[i / 2] = byte;
  }
  return bytes;
}

/**
 * Valida cookie HMAC-SHA256.
 * Formato do valor: "<tenantSlug>:<expiresUnixSeconds>.<hmac_hex>"
 * Espelho exato do generateMediaHubToken() na API.
 */
async function validateToken(cookieValue, secret) {
  if (!cookieValue || !secret) return false;

  const lastDot = cookieValue.lastIndexOf('.');
  if (lastDot === -1) return false;

  const payload = cookieValue.substring(0, lastDot);
  const receivedHmac = cookieValue.substring(lastDot + 1);

  // Verifica expiração antes de validar HMAC (fail-fast)
  const parts = payload.split(':');
  if (parts.length < 2) return false;
  const expires = parseInt(parts[parts.length - 1], 10);
  if (isNaN(expires) || Math.floor(Date.now() / 1000) > expires) return false;

  // Valida HMAC com Web Crypto API (disponível no Workers runtime)
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const hmacBytes = hexToBytes(receivedHmac);
  if (!hmacBytes) return false;

  try {
    return await crypto.subtle.verify('HMAC', cryptoKey, hmacBytes, encoder.encode(payload));
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── Pass-through para tudo fora de /media-hub/* ──────────────────────────
    // Outros prefixos do bucket (uploads/aisales-manager/*, etc.) passam sem alteração
    if (!pathname.startsWith(MEDIA_HUB_PREFIX)) {
      return fetch(new Request(request));
    }

    // ── Valida cookie para /media-hub/* ──────────────────────────────────────
    const cookies = parseCookies(request.headers.get('Cookie') || '');
    const token = cookies['mh_access_token'];
    const isValid = await validateToken(token, env.MH_TOKEN_SECRET);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Valid mh_access_token cookie required' }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // ── Token válido → fetch S3 com header secreto ───────────────────────────
    const ext = pathname.split('.').pop()?.toLowerCase();
    const isCacheable = ext === 'ts' || ext === 'webp' || ext === 'mp4';

    // Tenta cache do edge para conteúdo imutável (sem executar fetch ao S3)
    const cache = caches.default;
    const cacheKey = new Request(`https://${env.S3_BUCKET_DOMAIN}${pathname}`, { method: 'GET' });

    if (isCacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const resp = new Response(cached.body, cached);
        resp.headers.set('X-Cache', 'HIT');
        return addCorsHeaders(resp, request);
      }
    }

    // Monta request ao S3 com header Referer secreto (satisfaz bucket policy)
    const s3Url = `https://${env.S3_BUCKET_DOMAIN}${pathname}${url.search}`;
    const s3Headers = new Headers();
    s3Headers.set('Referer', env.CF_S3_SECRET);
    const range = request.headers.get('Range');
    if (range) s3Headers.set('Range', range); // suporte a seeking em mp4

    let s3Response;
    try {
      s3Response = await fetch(new Request(s3Url, { method: 'GET', headers: s3Headers }));
    } catch {
      return new Response(
        JSON.stringify({ error: 'UPSTREAM_ERROR', message: 'Failed to reach origin' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (s3Response.status === 404) {
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (!s3Response.ok && s3Response.status !== 206) {
      return new Response(JSON.stringify({ error: 'UPSTREAM_ERROR' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Monta response com headers de cache corretos e remove headers internos AWS
    const ttl = getCacheTtl(pathname);
    const responseHeaders = new Headers(s3Response.headers);
    responseHeaders.delete('x-amz-request-id');
    responseHeaders.delete('x-amz-id-2');
    responseHeaders.delete('server');
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('X-Cache', 'MISS');

    if (isCacheable) {
      responseHeaders.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}, immutable`);
    } else {
      // m3u8 e outros: cache curto
      responseHeaders.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    }

    const response = new Response(s3Response.body, {
      status: s3Response.status,
      headers: responseHeaders,
    });

    addCorsHeaders(response, request);

    // Armazena segmentos imutáveis no cache do edge
    if (isCacheable && s3Response.status === 200) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};

function addCorsHeaders(response, request) {
  const origin = request.headers.get('Origin');
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}
