# Implementation Plan: Media Hub — Admin API, CORS & S3 CORS

**Date**: 2026-04-12 | **Spec**: `.specify/spec.md` | **Constitution**: `.specify/constitution.md`

## Summary

Tres lacunas no Media Hub em producao impedem integracao self-service: (1) endpoints admin para gerenciar tenants/keys via API, (2) documentacao operacional de CORS no Swarm, (3) configuracao de CORS no bucket S3 para players HLS no browser. O item 1 requer codigo novo; itens 2 e 3 sao scripts + documentacao.

## Technical Context

**Codebase existente**: Monorepo pnpm com `packages/api`, `packages/worker`, `shared/`
**Em producao**: media.digital-ai.tech (Docker Swarm, Traefik, 2 replicas API + 2 Worker)
**DB schema existente**: `tenants`, `api_keys`, `uploads`, `files` — nao requer alteracao
**Shared functions existentes**: `createTenant()`, `generateApiKey()`, `createApiKey()` em `shared/src/db/queries/tenants.ts`

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Tenant Isolation | PASS | Admin endpoints operam acima dos tenants, nao dentro |
| Security by Default | PASS | Admin Key separada, constant-time compare, key hashing |
| API/Worker Separation | PASS | Admin routes so no API, nao afeta Worker |
| Stream-First | N/A | Nenhum upload envolvido |

## Architecture Decisions

### AD-01: Admin Key via env var (nao via banco)

**Decision**: A Admin Key e uma string fixa definida na env `ADMIN_KEY` do Docker Swarm.

**Rationale**:
- Simplicidade: nao requer tabela extra ou RBAC
- Seguranca: a key fica no Swarm secrets, nao no codigo
- Rotacao: `docker service update --env-add ADMIN_KEY=new_value` — zero downtime
- Nao ha necessidade de multiplos admins no momento

**Trade-off**: Se precisarmos de multiplos admins ou audit log de quem fez o que, precisaremos de RBAC. Mas isso e YAGNI agora.

### AD-02: Middleware admin separado do middleware tenant

**Decision**: Criar `requireAdmin` middleware separado do `requireAuth` existente.

**Rationale**:
- `requireAuth` faz lookup no banco (api_keys JOIN tenants). Admin Key nao esta no banco
- Misturar os dois cria complexidade desnecessaria e risco de bypass
- Admin endpoints vivem em prefix `/v1/admin/` com middleware proprio
- O middleware admin faz constant-time compare da key via `crypto.timingSafeEqual`

### AD-03: Reutilizar functions do shared

**Decision**: Os endpoints admin reutilizam `createTenant()`, `generateApiKey()`, `createApiKey()` do shared.

**Rationale**:
- Essas functions ja existem e sao usadas pelo `seed-tenant.ts`
- Precisaremos adicionar: `listTenants()`, `findTenantById()`, `revokeApiKey()`, `listApiKeysByTenant()`, `countActiveKeysByTenant()`
- Manter a logica de dados no shared garante consistencia

### AD-04: ADMIN_KEY obrigatoria para habilitar admin endpoints

**Decision**: Se `ADMIN_KEY` nao estiver definida, os endpoints admin retornam 503 Service Unavailable.

**Rationale**:
- Em dev local sem ADMIN_KEY, os endpoints nao ficam abertos — ficam desabilitados
- Isso previne acesso acidental em ambientes sem configuracao
- A env var e adicionada ao Zod schema em `env.ts` como optional

### AD-05: S3 CORS via script AWS CLI

**Decision**: Script shell que aplica `put-bucket-cors` via AWS CLI com origens parametrizaveis.

**Rationale**:
- AWS CLI ja esta disponivel no ambiente de deploy
- Nao faz sentido criar um endpoint para isso — e configuracao de infra, nao de aplicacao
- Script idempotente: pode re-rodar quantas vezes quiser
- CloudFront requer configuracao separada (cache policy com Origin header)

## Component Architecture

### Admin Request Flow

```
Request → Extract "Authorization: Bearer <ADMIN_KEY>" header
        → crypto.timingSafeEqual(received, env.ADMIN_KEY)
        → If match → proceed to route handler
        → If no match → 401 Unauthorized
        → If ADMIN_KEY not configured → 503 Service Unavailable
```

### New Files

```
packages/api/src/
├── middleware/
│   └── admin-auth.ts        # NEW — requireAdmin middleware
├── routes/
│   └── admin/
│       └── tenants.ts       # NEW — admin tenant + key routes
```

### Modified Files

```
shared/src/
├── config/
│   └── env.ts               # ADD ADMIN_KEY (optional string)
├── db/queries/
│   └── tenants.ts           # ADD listTenants, findTenantById, revokeApiKey, listApiKeysByTenant, countActiveKeysByTenant
├── index.ts                 # ADD new exports

packages/api/src/
├── server.ts                # REGISTER admin routes

scripts/
├── configure-s3-cors.sh     # NEW — AWS CLI S3 CORS config

docs/
├── admin-api.md             # NEW — admin API documentation
├── cors-configuration.md    # NEW — CORS (Fastify + S3) documentation
```

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Admin Key leak em logs | Full admin access | Low | Never log the key value; log only "admin auth success/fail" |
| Timing attack na Admin Key | Key discovery | Very Low | Use `crypto.timingSafeEqual` |
| S3 CORS misconfiguration | Videos nao reproduzem | Medium | Script com validacao; testar com curl antes de deploy |
| CloudFront caching CORS | Intermittent CORS failures | Medium | Documentar cache policy com `Origin` como cache key |
| ADMIN_KEY nao configurada no Swarm | Admin endpoints inacessiveis | Low | Retornar 503 com mensagem clara; documentar no deploy guide |

## Dependencies

| Dependency | Required By | Notes |
|------------|-------------|-------|
| `ADMIN_KEY` env var no Swarm | Admin endpoints | Adicionar via `docker service update` |
| AWS CLI no ambiente de deploy | S3 CORS script | Ja disponivel |
| CloudFront config | S3 CORS funcionar via CDN | Config manual ou via AWS CLI |

## Environment Variables (New)

```env
# Admin API (new)
ADMIN_KEY=uma-chave-secreta-longa-gerada-com-openssl   # required para admin endpoints
```
