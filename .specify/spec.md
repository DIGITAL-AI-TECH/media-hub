# Feature Specification: Media Hub — Admin API, CORS & S3 CORS

**Created**: 2026-04-12
**Status**: Draft
**Scope**: 3 itens pendentes para integracao programatica com backends clientes
**Depends on**: Spec original (v1) — sistema ja em producao em media.digital-ai.tech

---

## Context

O Media Hub esta em producao. Upload, processamento (video HLS, imagem WebP, audio MP3), webhook callbacks e autenticacao por API Key funcionam. Porem, tres lacunas impedem integracao self-service por backends clientes:

1. **Nao existe API admin** — criar tenants requer rodar `scripts/seed-tenant.ts` via CLI no servidor
2. **CORS do Fastify** esta `*` em producao — funciona mas e inseguro
3. **S3 CORS nao esta configurado** — players HLS no browser nao conseguem fazer fetch dos segmentos `.ts`/`.m3u8` do CDN

---

## User Story 1 — Gerenciamento de Tenants via Admin API (Priority: P1)

Como operador da Digital AI, eu gerencio tenants e API keys via endpoints REST protegidos por Admin Key, para que a integracao de novos clientes seja programatica e nao dependa de acesso SSH ao servidor.

**Why P1**: Sem isso, cada novo cliente requer intervencao manual no servidor. Bloqueia escalabilidade e automacao (ex: n8n workflow de onboarding).

**Independent Test**: Usar Admin Key para criar tenant, gerar API key, usar a API key gerada para fazer upload — tudo via curl, sem CLI.

### Acceptance Scenarios

1. **Given** a env `ADMIN_KEY` configurada no Swarm, **When** eu envio `POST /v1/admin/tenants` com header `Authorization: Bearer <ADMIN_KEY>` e body `{ "slug": "acme", "name": "Acme Corp" }`, **Then** recebo 201 com `{ tenant_id, slug, name, scopes, created_at }`
2. **Given** um tenant existente, **When** eu envio `POST /v1/admin/tenants/:tenantId/keys` com header Admin Key e body `{ "label": "backend-prod", "scopes": ["media:upload", "media:read"] }`, **Then** recebo 201 com `{ key_id, key (plaintext, unica vez), prefix, label, scopes, created_at }`
3. **Given** uma API key ativa, **When** eu envio `DELETE /v1/admin/keys/:keyId` com header Admin Key, **Then** a key e revogada (soft delete via `revoked_at`), retorno 204, e requests usando essa key passam a receber 401
4. **Given** Admin Key configurada, **When** eu envio `GET /v1/admin/tenants`, **Then** recebo lista de todos os tenants com `{ id, slug, name, scopes, is_active, created_at, keys_count }`
5. **Given** request sem header Authorization ou com key invalida, **When** eu tento acessar qualquer endpoint `/v1/admin/*`, **Then** recebo 401
6. **Given** request com API key de tenant (nao Admin Key), **When** eu tento acessar `/v1/admin/*`, **Then** recebo 401 (admin auth e separada)
7. **Given** body com slug duplicado, **When** eu envio `POST /v1/admin/tenants`, **Then** recebo 409 Conflict

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/admin/tenants` | Admin Key | Criar tenant |
| `GET` | `/v1/admin/tenants` | Admin Key | Listar tenants |
| `POST` | `/v1/admin/tenants/:tenantId/keys` | Admin Key | Gerar API key para tenant |
| `DELETE` | `/v1/admin/keys/:keyId` | Admin Key | Revogar API key |

### Request/Response Schemas

**POST /v1/admin/tenants**
```json
// Request
{
  "slug": "acme-corp",        // required, ^[a-z0-9-]{2,64}$
  "name": "Acme Corporation", // required, max 256
  "scopes": ["media:upload", "media:read", "media:delete"] // optional, defaults to ["media:upload", "media:read"]
}

// Response 201
{
  "tenant_id": "uuid",
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "scopes": ["media:upload", "media:read", "media:delete"],
  "is_active": true,
  "created_at": "ISO8601"
}
```

**POST /v1/admin/tenants/:tenantId/keys**
```json
// Request
{
  "label": "backend-prod",    // optional, max 128
  "scopes": ["media:upload", "media:read"] // optional, inherits tenant scopes if omitted
}

// Response 201
{
  "key_id": "uuid",
  "key": "mh_acme-corp_a1b2c3...", // PLAINTEXT — shown ONCE
  "prefix": "mh_acme-corp_",
  "label": "backend-prod",
  "scopes": ["media:upload", "media:read"],
  "created_at": "ISO8601"
}
```

**GET /v1/admin/tenants**
```json
// Response 200
{
  "tenants": [
    {
      "tenant_id": "uuid",
      "slug": "acme-corp",
      "name": "Acme Corporation",
      "scopes": ["media:upload", "media:read"],
      "is_active": true,
      "keys_count": 2,
      "created_at": "ISO8601"
    }
  ]
}
```

**DELETE /v1/admin/keys/:keyId**
```
Response 204 No Content
```

---

## User Story 2 — CORS Configuravel em Producao (Priority: P2)

Como DevOps da Digital AI, eu configuro origens CORS permitidas via variavel de ambiente no Docker Swarm, para que apenas dominios autorizados possam chamar a API do Media Hub pelo browser.

**Why P2**: O sistema funciona com `*` mas e inseguro em producao. A infra de env var ja existe (`ALLOWED_ORIGINS`), falta apenas documentacao e validacao.

**Independent Test**: Setar `ALLOWED_ORIGINS=https://app.client.com,https://admin.digital-ai.tech`, reiniciar servico, verificar que requests de outras origens recebem CORS block.

### Acceptance Scenarios

1. **Given** `ALLOWED_ORIGINS=https://app.client.com`, **When** request vem com `Origin: https://app.client.com`, **Then** resposta inclui `Access-Control-Allow-Origin: https://app.client.com`
2. **Given** `ALLOWED_ORIGINS=https://app.client.com`, **When** request vem com `Origin: https://evil.com`, **Then** resposta NAO inclui header CORS (browser bloqueia)
3. **Given** `ALLOWED_ORIGINS=*` e `NODE_ENV=production`, **When** o servico inicia, **Then** log warning `[WARN] ALLOWED_ORIGINS=* in production` e emitido (ja implementado)
4. **Given** multiplas origens `ALLOWED_ORIGINS=https://a.com,https://b.com`, **When** requests vem de ambos, **Then** ambos sao aceitos
5. **Given** `ALLOWED_ORIGINS` nao definido, **Then** default e `*` (retrocompativel)

### Implementacao Necessaria

- O codigo em `server.ts` ja trata `ALLOWED_ORIGINS` corretamente (split por `,` ou `true` para `*`)
- O env.ts ja valida e tem warning de producao
- **O que falta**: documentacao operacional de como atualizar no Swarm

---

## User Story 3 — S3 CORS para Player HLS no Browser (Priority: P1)

Como desenvolvedor frontend integrando Media Hub, eu preciso que o bucket S3 (servido via CDN `cdn.digital-ai.tech`) aceite requests CORS do meu dominio, para que players HLS (HLS.js, Video.js) consigam fazer fetch dos segmentos `.ts` e manifestos `.m3u8` diretamente.

**Why P1**: Sem S3 CORS, o video processado pelo Media Hub e inacessivel para qualquer player web. A funcionalidade de video fica incompleta.

**Independent Test**: Configurar CORS no bucket, abrir pagina com HLS.js em `https://app.client.com`, apontar para `https://cdn.digital-ai.tech/media-hub/.../master.m3u8`, verificar que o video reproduz sem erros de CORS.

### Acceptance Scenarios

1. **Given** CORS configurado no bucket com origem `https://app.client.com`, **When** HLS.js faz `GET` para `https://cdn.digital-ai.tech/.../master.m3u8` com `Origin: https://app.client.com`, **Then** resposta S3 inclui `Access-Control-Allow-Origin: https://app.client.com`
2. **Given** CORS configurado, **When** browser faz preflight `OPTIONS` para `.ts` segment, **Then** resposta S3 retorna headers CORS com `Access-Control-Allow-Methods: GET, HEAD`
3. **Given** CORS configurado com multiplas origens, **When** novo cliente e adicionado, **Then** basta re-rodar o script com a nova lista de origens
4. **Given** CloudFront na frente do S3, **When** CORS e configurado no bucket, **Then** CloudFront precisa forward do header `Origin` e cache por origin (via cache policy)

### Implementacao Necessaria

- Script shell/TS que recebe lista de origens e aplica CORS config no bucket via AWS CLI
- Documentacao de como o CloudFront precisa ser configurado para forwarding de CORS headers
- O script deve ser idempotente (pode re-rodar sem efeitos colaterais)

---

## Edge Cases

- **Admin Key rotacao**: Se a env `ADMIN_KEY` mudar, basta `docker service update --env-add`. Nao afeta API keys de tenants
- **Admin Key vazia**: Se `ADMIN_KEY` nao estiver definida, endpoints admin retornam 503 com mensagem clara
- **S3 CORS com CloudFront**: CloudFront pode cachear respostas sem CORS headers. Precisa configurar `Origin` como cache key via cache policy ou origin request policy
- **Slug collision**: Tentar criar tenant com slug existente retorna 409, nao erro generico 500

---

## Requirements

### Functional Requirements

- **FR-A01**: System MUST authenticate admin endpoints via `ADMIN_KEY` env var, separado do sistema de API keys de tenant
- **FR-A02**: System MUST provide `POST /v1/admin/tenants` endpoint para criar tenants com slug, name e scopes
- **FR-A03**: System MUST provide `POST /v1/admin/tenants/:tenantId/keys` para gerar API keys com label e scopes opcionais
- **FR-A04**: System MUST provide `DELETE /v1/admin/keys/:keyId` para revogar API keys (soft delete via `revoked_at`)
- **FR-A05**: System MUST provide `GET /v1/admin/tenants` para listar todos os tenants com contagem de keys ativas
- **FR-A06**: System MUST validate slug format (`^[a-z0-9-]{2,64}$`) e retornar 422 se invalido
- **FR-A07**: System MUST retornar 409 Conflict se slug ja existe
- **FR-A08**: System MUST retornar API key em plaintext APENAS na resposta de criacao — nunca mais
- **FR-A09**: System MUST NOT reuse o middleware `requireAuth` de tenants para admin — auth admin e separada
- **FR-C01**: System MUST log warning quando `ALLOWED_ORIGINS=*` em `NODE_ENV=production` (ja implementado)
- **FR-S01**: Bucket S3 MUST ter CORS configurado para aceitar GET/HEAD de origens especificas
- **FR-S02**: Script de CORS MUST ser idempotente e aceitar lista de origens como parametro

### Non-Functional Requirements

- **NFR-A01**: Admin endpoints MUST responder em < 100ms (p95)
- **NFR-A02**: Admin Key MUST ser comparada em constant-time para prevenir timing attacks
- **NFR-S01**: S3 CORS config MUST suportar ate 100 origens (limite AWS)

---

## Success Criteria

- **SC-A01**: Criar tenant + gerar key + usar key para upload — tudo via HTTP, sem CLI
- **SC-A02**: Revogar key e verificar que requests com ela retornam 401
- **SC-C01**: CORS block efetivo para origens nao autorizadas
- **SC-S01**: Player HLS.js reproduz video do CDN sem erros CORS em qualquer dominio autorizado
