# Media Hub — Integration Guide

> Guia completo para integrar sua plataforma com o Media Hub, o servico de upload e processamento de midia da Digital AI.

## Visao Geral

Media Hub e um servico multi-tenant de upload e processamento de midia. Ele aceita arquivos de qualquer tipo, processa automaticamente (video, imagem, audio) e entrega URLs otimizadas para reproducao adaptativa.

**Base URL**: `https://media.digital-ai.tech/v1`

## Autenticacao

Todas as requisicoes devem incluir uma API Key no header `Authorization`:

```
Authorization: Bearer mh_seuslug_a1b2c3d4e5f6...
```

A API Key e gerada pelo administrador e possui **scopes** que definem o que voce pode fazer:

| Scope | Permissao |
|-------|-----------|
| `media:upload` | Criar uploads e enviar arquivos |
| `media:read` | Consultar status de uploads e arquivos |
| `media:delete` | Deletar arquivos |
| `admin:tenants` | Gerenciar tenants (admin only) |

### Rotacao de Chaves

Cada tenant pode ter **2 chaves ativas simultaneamente**. Para rotacionar sem downtime:

1. Gere uma segunda chave (admin endpoint)
2. Atualize sua aplicacao para usar a nova chave
3. Revogue a chave antiga

## Fluxo de Upload

### 1. Criar Sessao de Upload

```http
POST /v1/uploads
Content-Type: application/json
Authorization: Bearer mh_...

{
  "external_ref": "post-123",
  "callback_url": "https://sua-api.com/webhooks/media-hub",
  "callback_secret": "seu-secret-para-hmac",
  "metadata": {
    "project": "julia-pipeline",
    "batch": "2026-04-12"
  }
}
```

**Resposta** (201 Created):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "...",
  "external_ref": "post-123",
  "status": "pending",
  "files_count": 0,
  "callback_url": "https://sua-api.com/webhooks/media-hub",
  "metadata": { "project": "julia-pipeline", "batch": "2026-04-12" },
  "created_at": "2026-04-12T10:00:00Z"
}
```

**Campos**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `external_ref` | string | Nao | Referencia do seu sistema para correlacao |
| `callback_url` | string | Nao | URL para receber webhook quando processamento terminar |
| `callback_secret` | string | Nao | Secret para assinar o webhook com HMAC-SHA256 |
| `metadata` | object | Nao | Dados livres (JSONB) para seu controle |

### 2. Enviar Arquivos

Envie cada arquivo como `multipart/form-data`. Voce pode enviar **multiplos arquivos em paralelo** para o mesmo `upload_id`:

```http
POST /v1/uploads/550e8400.../files
Content-Type: multipart/form-data
Authorization: Bearer mh_...

--boundary
Content-Disposition: form-data; name="file"; filename="video-produto.mp4"
Content-Type: video/mp4

<binary data>
--boundary--
```

**Resposta** (201 Created):

```json
{
  "id": "file-uuid-here",
  "upload_id": "550e8400...",
  "original_name": "video-produto.mp4",
  "mime_type": "video/mp4",
  "size_bytes": 52428800,
  "media_type": "video",
  "status": "pending",
  "created_at": "2026-04-12T10:00:05Z"
}
```

O arquivo e transmitido diretamente para o S3 (streaming) — nao ha limite pratico de tamanho.

### 3. Processamento Automatico

O Media Hub detecta o tipo de midia pelo MIME type e aplica o processamento adequado:

| Media Type | Deteccao | Processamento |
|-----------|----------|---------------|
| **video** | `video/*` | HLS adaptativo (360p, 720p, 1080p, 4K conforme original), H.264, thumbnail WebP |
| **image** | `image/*` | WebP (quality 80), thumbnails 320px e 720px |
| **audio** | `audio/*` | MP3 192kbps normalizado |
| **generic** | qualquer outro | Sem processamento — armazenamento direto |

**Video**: Apenas resolucoes **menores ou iguais** ao original sao geradas. Um video 720p nao gera variante 1080p ou 4K.

### 4. Receber Webhook (Callback)

Quando **todos os arquivos** de um upload terminam (sucesso ou falha), o Media Hub envia um POST para o `callback_url`:

```http
POST https://sua-api.com/webhooks/media-hub
Content-Type: application/json
X-MediaHub-Signature: sha256=abc123...
X-MediaHub-Timestamp: 1712930400

{
  "upload_id": "550e8400...",
  "external_ref": "post-123",
  "status": "completed",
  "files": [
    {
      "id": "file-1-uuid",
      "original_name": "video-produto.mp4",
      "media_type": "video",
      "status": "completed",
      "processed_urls": {
        "master": "media-hub/tenant/processed/upload-id/file-id/video/master.m3u8",
        "360p": "media-hub/tenant/processed/upload-id/file-id/video/360p.m3u8",
        "720p": "media-hub/tenant/processed/upload-id/file-id/video/720p.m3u8",
        "thumbnail": "media-hub/tenant/processed/upload-id/file-id/video/thumb.webp"
      }
    },
    {
      "id": "file-2-uuid",
      "original_name": "capa.jpg",
      "media_type": "image",
      "status": "completed",
      "processed_urls": {
        "original": "media-hub/tenant/processed/upload-id/file-id/image/original.webp",
        "thumb_320": "media-hub/tenant/processed/upload-id/file-id/image/thumb_320.webp",
        "thumb_720": "media-hub/tenant/processed/upload-id/file-id/image/thumb_720.webp"
      }
    }
  ],
  "metadata": { "project": "julia-pipeline", "batch": "2026-04-12" }
}
```

**Status do upload**:
- `completed` — todos os arquivos processados com sucesso
- `partial` — pelo menos um arquivo falhou, demais processados
- `failed` — todos os arquivos falharam

### 5. Verificar Assinatura do Webhook

Se voce forneceu `callback_secret`, o webhook inclui headers de assinatura:

```
X-MediaHub-Signature: sha256=<hmac>
X-MediaHub-Timestamp: <unix-epoch-seconds>
```

Para verificar (Node.js):

```typescript
import crypto from 'crypto';

function verifyWebhook(body: string, signature: string, timestamp: string, secret: string): boolean {
  // Rejeitar se timestamp > 5 minutos atras
  const now = Math.floor(Date.now() / 1000);
  if (now - parseInt(timestamp) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expected)
  );
}
```

## Consultar Status

### Status de um Upload

```http
GET /v1/uploads/550e8400...
Authorization: Bearer mh_...
```

**Resposta**:

```json
{
  "id": "550e8400...",
  "status": "processing",
  "files_count": 3,
  "files": [
    { "id": "...", "status": "completed", "media_type": "image", "processed_urls": {...} },
    { "id": "...", "status": "processing", "media_type": "video", "processed_urls": null },
    { "id": "...", "status": "pending", "media_type": "audio", "processed_urls": null }
  ],
  "counts": {
    "total": 3,
    "completed": 1,
    "processing": 1,
    "pending": 1,
    "failed": 0
  }
}
```

### Status de um Arquivo

```http
GET /v1/files/file-uuid
Authorization: Bearer mh_...
```

## Deletar Arquivo

```http
DELETE /v1/files/file-uuid
Authorization: Bearer mh_...
```

Requer scope `media:delete`. Remove o arquivo do S3 (raw + processado) e do banco de dados.

**Restricoes**:
- Nao e possivel deletar arquivo em processamento (retorna 409)
- So e possivel deletar arquivos do proprio tenant

## Health Check

```http
GET /v1/health/auth
Authorization: Bearer mh_...
```

**Resposta (200)**:

```json
{
  "status": "ok",
  "dependencies": {
    "postgres": "ok",
    "redis": "ok",
    "s3": "ok"
  }
}
```

## Erros

Todos os erros seguem o formato:

```json
{
  "error": {
    "code": "MH-001",
    "message": "Descricao do erro",
    "details": {}
  }
}
```

| Codigo HTTP | Error Code | Descricao |
|-------------|-----------|-----------|
| 400 | MH-001 | Corpo da requisicao invalido |
| 401 | MH-002 | API Key ausente ou invalida |
| 403 | MH-003 | Scope insuficiente para esta operacao |
| 404 | MH-004 | Recurso nao encontrado |
| 409 | MH-005 | Conflito (ex: arquivo em processamento, limite de keys) |
| 413 | MH-006 | Arquivo excede tamanho maximo (se configurado) |
| 429 | MH-007 | Rate limit excedido |
| 502 | MH-008 | Erro de comunicacao com S3 |
| 503 | MH-009 | Servico degradado (dependencia indisponivel) |

## Exemplos de Integracao

### Node.js / TypeScript

```typescript
import FormData from 'form-data';
import fs from 'fs';

const API_URL = 'https://media.digital-ai.tech/v1';
const API_KEY = 'mh_seuslug_...';

// 1. Criar upload
const upload = await fetch(`${API_URL}/uploads`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    external_ref: 'meu-post-123',
    callback_url: 'https://minha-api.com/webhook',
  }),
}).then(r => r.json());

// 2. Enviar arquivo
const form = new FormData();
form.append('file', fs.createReadStream('./video.mp4'));

await fetch(`${API_URL}/uploads/${upload.id}/files`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    ...form.getHeaders(),
  },
  body: form,
});

// 3. Webhook recebe o resultado automaticamente
```

### Python

```python
import requests

API_URL = 'https://media.digital-ai.tech/v1'
API_KEY = 'mh_seuslug_...'
headers = {'Authorization': f'Bearer {API_KEY}'}

# 1. Criar upload
upload = requests.post(f'{API_URL}/uploads', json={
    'external_ref': 'meu-post-123',
    'callback_url': 'https://minha-api.com/webhook',
}, headers=headers).json()

# 2. Enviar arquivo
with open('video.mp4', 'rb') as f:
    requests.post(
        f'{API_URL}/uploads/{upload["id"]}/files',
        files={'file': ('video.mp4', f, 'video/mp4')},
        headers=headers,
    )

# 3. Webhook recebe o resultado automaticamente
```

### cURL

```bash
# 1. Criar upload
UPLOAD_ID=$(curl -s -X POST "$API_URL/uploads" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callback_url":"https://minha-api.com/webhook"}' | jq -r '.id')

# 2. Enviar arquivo
curl -X POST "$API_URL/uploads/$UPLOAD_ID/files" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@video.mp4"
```

## Upload em Lote (Batch)

Para upload de multiplos arquivos, crie **um upload** e envie os arquivos **em paralelo**:

```typescript
// Criar um unico upload
const upload = await createUpload({ callback_url: '...' });

// Enviar 10 arquivos em paralelo
const files = ['img1.jpg', 'img2.jpg', 'video1.mp4', /* ... */];

await Promise.all(
  files.map(file =>
    uploadFile(upload.id, file) // cada um faz POST /uploads/:id/files
  )
);

// UM unico webhook sera disparado quando TODOS terminarem
```

## Estrutura do S3

Os arquivos sao organizados no S3 da seguinte forma:

```
media-hub/
  {tenant_slug}/
    raw/{upload_id}/{file_id}_original.ext      # Arquivo original
    processed/{upload_id}/{file_id}/
      video/
        master.m3u8                              # Playlist master (HLS)
        360p.m3u8, 360p_0000.ts, ...            # Variante 360p
        720p.m3u8, 720p_0000.ts, ...            # Variante 720p
        1080p.m3u8, 1080p_0000.ts, ...          # Variante 1080p
        4k.m3u8, 4k_0000.ts, ...                # Variante 4K (se aplicavel)
        thumb.webp                               # Thumbnail
      image/
        original.webp                            # Imagem convertida
        thumb_320.webp                           # Thumbnail 320px
        thumb_720.webp                           # Thumbnail 720px
      audio/
        audio.mp3                                # Audio normalizado
```

## Limites e Recomendacoes

| Aspecto | Valor |
|---------|-------|
| Tamanho maximo por arquivo | Sem limite hard (stream-first), recomendado < 10GB |
| Arquivos por upload | Sem limite hard, recomendado < 100 |
| API Keys por tenant | 2 ativas simultaneamente |
| Retries de webhook | 3 tentativas (1s, 10s, 60s) |
| Retries de processamento | 3 tentativas (backoff exponencial) |
| Tempo limite para video processamento | ~1 min por minuto de video (estimativa) |

## Suporte

Para duvidas ou problemas com a integracao, entre em contato com a equipe Digital AI.
