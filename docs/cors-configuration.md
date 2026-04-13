# CORS Configuration — Media Hub

Guia completo para configurar CORS no Media Hub (Fastify API + S3/CDN).

---

## 1. API CORS (Fastify)

### Como funciona

A variável de ambiente `ALLOWED_ORIGINS` controla as origens aceitas pela API. Ela já está implementada — nenhuma mudança de código é necessária.

| Valor | Comportamento |
|-------|--------------|
| `*` | Aceita qualquer origem (desenvolvimento / não recomendado em produção) |
| `https://app.com` | Aceita apenas essa origem |
| `https://a.com,https://b.com` | Aceita múltiplas origens (separadas por vírgula) |

> **Aviso**: Em produção com `ALLOWED_ORIGINS=*`, a API loga um warning. Sempre configure origens explícitas em produção.

### Atualizar via Docker Swarm

```bash
# Single origin
docker service update \
  --env-add ALLOWED_ORIGINS=https://app.seucliente.com \
  media-hub_api

# Múltiplas origens
docker service update \
  --env-add ALLOWED_ORIGINS=https://app.seucliente.com,https://admin.seucliente.com \
  media-hub_api

# Verificar valor atual
docker service inspect media-hub_api --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep ALLOWED_ORIGINS
```

A atualização é feita com rolling restart — sem downtime.

### Verificar que CORS está funcionando

```bash
# Deve retornar Access-Control-Allow-Origin: https://app.seucliente.com
curl -I \
  -H "Origin: https://app.seucliente.com" \
  -H "Authorization: Bearer mh_..." \
  https://media.digital-ai.tech/v1/health/auth

# Origem não permitida — deve retornar sem o header CORS (ou 403 em browsers)
curl -I \
  -H "Origin: https://naoautorizado.com" \
  https://media.digital-ai.tech/v1/health
```

---

## 2. S3 CORS (para players HLS no browser)

### Por que é necessário

As URLs HLS geradas pelo Media Hub apontam para `https://cdn.digital-ai.tech`. Quando um player web (HLS.js, Video.js, `<video>` nativo) tenta buscar segmentos `.ts` e arquivos `.m3u8` diretamente, o browser impõe CORS. Sem a configuração correta no bucket S3, o player falha silenciosamente.

### Quando configurar

- Ao integrar um novo cliente com player web
- Ao adicionar um novo domínio de frontend que vai reproduzir vídeos
- **Não é necessário** para players mobile nativos (iOS/Android) ou server-side

### Como configurar

Use o script `scripts/configure-s3-cors.sh`, passando as origens autorizadas:

```bash
# Configurar para um cliente
./scripts/configure-s3-cors.sh https://app.seucliente.com

# Configurar para múltiplos clientes
./scripts/configure-s3-cors.sh https://app.cliente1.com https://app.cliente2.com https://admin.cliente2.com

# O script requer AWS CLI configurado com as credenciais do bucket.
# As credenciais ficam em /cortex/secrets/clients/media-hub.env
# Exemplo de execução com variáveis explícitas:
AWS_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
AWS_SECRET_ACCESS_KEY='<S3_SECRET_ACCESS_KEY>' \
AWS_DEFAULT_REGION=us-east-1 \
S3_BUCKET=cdn.digital-ai.tech \
./scripts/configure-s3-cors.sh https://app.seucliente.com
```

> **Atenção**: O script substitui a configuração CORS inteira. Sempre inclua TODAS as origens autorizadas na mesma chamada.

### Verificar que S3 CORS está funcionando

```bash
# Deve retornar Access-Control-Allow-Origin e Access-Control-Allow-Methods
curl -sI \
  -H "Origin: https://app.seucliente.com" \
  "https://cdn.digital-ai.tech/media-hub/[tenant-slug]/processed/[upload-id]/[file-id]/video/master.m3u8"

# Resposta esperada:
# HTTP/2 200
# access-control-allow-origin: https://app.seucliente.com
# access-control-allow-methods: GET, HEAD
```

### Configuração CloudFront (importante)

Se o CDN usa CloudFront na frente do S3 (necessário para URLs `cdn.digital-ai.tech`), é preciso configurar:

**1. Origin Request Policy** — encaminhar o header `Origin` ao S3:
```
CloudFront > Behaviors > Edit > Origin request policy
→ Selecionar "CORS-S3Origin" (managed policy da AWS)
```

**2. Cache Policy** — incluir `Origin` como chave de cache:
```
CloudFront > Behaviors > Edit > Cache policy
→ Selecionar "CORS-with-preflight" ou criar política customizada com "Origin" em Cache key headers
```

> **Por que isso importa**: Sem incluir `Origin` no cache key, o CloudFront cacheia a resposta de uma origem e serve essa resposta (sem o header CORS correto) para outras origens.

**Troubleshooting**:
```bash
# Se CORS ainda não funciona após configurar S3 + CloudFront:
# 1. Verificar se a configuração S3 foi aplicada
aws s3api get-bucket-cors --bucket cdn.digital-ai.tech

# 2. Invalidar cache do CloudFront
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"
```

---

## 3. Admin API CORS

Os endpoints `/v1/admin/*` são para uso server-to-server e não devem ser chamados de browsers. A proteção é feita via `ADMIN_KEY` no header `Authorization`. CORS da API se aplica da mesma forma que os demais endpoints.

---

## Referência rápida

| Cenário | O que configurar |
|---------|-----------------|
| API chamada de browser (uploads, consultas) | `ALLOWED_ORIGINS` env var via `docker service update` |
| Player HLS no browser | S3 CORS via `configure-s3-cors.sh` + CloudFront Origin header |
| App mobile nativo | Nada — CORS não se aplica |
| Integração server-to-server | Nada — CORS não se aplica |
