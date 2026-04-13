# Tasks: Media Hub — Admin API, CORS & S3 CORS

**Input**: `.specify/plan.md`, `.specify/spec.md`, `.specify/constitution.md`
**Prerequisites**: Media Hub em producao; spec aprovada

## Format: `[ID] [Complexity] [Story] Description`

- Complexity: S (< 1h), M (1-3h), L (3-8h)
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = Admin API, US2 = CORS docs, US3 = S3 CORS

---

## Phase 1: Shared Layer (queries + env)

**Purpose**: Adicionar queries e config que os endpoints admin precisam

- [ ] T01 **[S] [US1]** Adicionar `ADMIN_KEY` ao schema Zod em `shared/src/config/env.ts` como `z.string().optional()`. Nao quebra nada existente — campo optional
- [ ] T02 **[M] [US1]** Adicionar queries ao `shared/src/db/queries/tenants.ts`:
  - `listTenants(pool)` — SELECT todos os tenants com COUNT de api_keys ativas (revoked_at IS NULL)
  - `findTenantById(pool, id)` — SELECT tenant por UUID
  - `revokeApiKey(pool, keyId)` — UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 RETURNING *
  - `listApiKeysByTenant(pool, tenantId)` — SELECT api_keys WHERE tenant_id (sem key_hash!) com status (active/revoked/expired)
  - `countActiveKeysByTenant(pool, tenantId)` — COUNT api_keys WHERE tenant_id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
- [ ] T03 **[S] [US1]** Atualizar `shared/src/index.ts` — exportar as novas functions

**Checkpoint**: `pnpm build` compila sem erros. Novas functions exportadas do shared

---

## Phase 2: Admin Auth Middleware

**Purpose**: Middleware de autenticacao separado para endpoints admin

- [ ] T04 **[M] [US1]** Criar `packages/api/src/middleware/admin-auth.ts`:
  - Function `requireAdmin(request, reply)`
  - Extrai `Authorization: Bearer <key>` do header
  - Se `env.ADMIN_KEY` nao definida → 503 `{ error: "SERVICE_UNAVAILABLE", message: "Admin API not configured" }`
  - Compara com `crypto.timingSafeEqual(Buffer.from(received), Buffer.from(env.ADMIN_KEY))`
  - Se match → continue (nao seta `request.tenant` — admin nao e tenant)
  - Se no match → 401 `{ error: "UNAUTHORIZED", message: "Invalid admin key" }`
  - Log: nunca logar o valor da key, apenas resultado (success/fail)

**Checkpoint**: Middleware compila. Import funciona

---

## Phase 3: Admin Routes

**Purpose**: Endpoints REST para gerenciar tenants e API keys

- [ ] T05 **[L] [US1]** Criar `packages/api/src/routes/admin/tenants.ts` com os 4 endpoints:

  **POST /v1/admin/tenants**
  - preHandler: `requireAdmin`
  - Validar body com Zod: `slug` (regex `^[a-z0-9-]{2,64}$`, required), `name` (string max 256, required), `scopes` (array of strings, optional, default `["media:upload", "media:read"]`)
  - Chamar `createTenant(pool, slug, name, scopes)` do shared
  - Catch unique violation (pg error 23505 on slug) → 409 Conflict
  - Return 201 com tenant data

  **GET /v1/admin/tenants**
  - preHandler: `requireAdmin`
  - Chamar `listTenants(pool)` do shared
  - Return 200 com `{ tenants: [...] }`

  **POST /v1/admin/tenants/:tenantId/keys**
  - preHandler: `requireAdmin`
  - Validar `tenantId` como UUID
  - Verificar tenant existe via `findTenantById(pool, tenantId)` → 404 se nao
  - Validar body com Zod: `label` (string max 128, optional), `scopes` (array, optional — herda do tenant se omitido)
  - Chamar `generateApiKey(tenant.slug)` → `{ key, hash, prefix }`
  - Chamar `createApiKey(pool, tenantId, hash, prefix, label, scopes)`
  - Return 201 com `{ key_id, key (plaintext), prefix, label, scopes, created_at }`

  **DELETE /v1/admin/keys/:keyId**
  - preHandler: `requireAdmin`
  - Validar `keyId` como UUID
  - Chamar `revokeApiKey(pool, keyId)` → 404 se nao encontrou
  - Return 204

- [ ] T06 **[S] [US1]** Registrar admin routes no `packages/api/src/server.ts`:
  - Import `adminTenantRoutes` de `./routes/admin/tenants.js`
  - `await fastify.register(adminTenantRoutes)`

**Checkpoint**: Todos os 4 endpoints respondem. Build passa. Admin key autentica

---

## Phase 4: Documentacao CORS (Fastify + Swarm)

**Purpose**: Documentar como configurar CORS em producao

- [ ] T07 **[S] [US2]** Criar `docs/cors-configuration.md`:
  - Explicar `ALLOWED_ORIGINS` env var (ja implementada)
  - Como atualizar no Swarm: `docker service update --env-add ALLOWED_ORIGINS=https://a.com,https://b.com media-hub_api`
  - Exemplos de configuracao para cenarios comuns:
    - Single origin: `ALLOWED_ORIGINS=https://app.client.com`
    - Multiple origins: `ALLOWED_ORIGINS=https://a.com,https://b.com`
    - Development (allow all): `ALLOWED_ORIGINS=*`
  - Warning: nunca usar `*` em producao para APIs autenticadas
  - Como verificar que CORS esta funcionando (curl com -H Origin)

**Checkpoint**: Documento completo com exemplos copiáveis

---

## Phase 5: S3 CORS Script + Docs

**Purpose**: Configurar CORS no bucket S3 para players HLS no browser

- [ ] T08 **[M] [US3]** Criar `scripts/configure-s3-cors.sh`:
  - Aceita origens como argumentos: `./configure-s3-cors.sh https://app1.com https://app2.com`
  - Gera JSON de CORS config com:
    ```json
    {
      "CORSRules": [{
        "AllowedOrigins": ["<origins>"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
        "MaxAgeSeconds": 86400
      }]
    }
    ```
  - Executa `aws s3api put-bucket-cors --bucket $S3_BUCKET --cors-configuration file:///tmp/cors.json`
  - Valida resultado com `aws s3api get-bucket-cors --bucket $S3_BUCKET`
  - Idempotente: pode re-rodar sem efeitos colaterais (put-bucket-cors substitui config anterior)
  - Se nenhuma origem passada, mostra usage e sai com erro
  - Usa `S3_BUCKET` env var ou aceita via `--bucket` flag

- [ ] T09 **[S] [US3]** Adicionar secao S3 CORS ao `docs/cors-configuration.md`:
  - Quando configurar (ao adicionar novo cliente que usa player web)
  - Como rodar o script
  - Configuracao necessaria no CloudFront:
    - Origin Request Policy: forward `Origin` header ao S3
    - Cache Policy: incluir `Origin` como cache key (senao CloudFront cacheia resposta sem CORS de uma origem e serve para todas)
    - OU usar managed policy `CORS-S3Origin` da AWS
  - Como testar: `curl -H "Origin: https://app.com" -I https://cdn.digital-ai.tech/media-hub/.../master.m3u8`
  - Troubleshooting: se CORS nao funciona mesmo com config correta, invalidar cache do CloudFront

**Checkpoint**: Script funciona. Docs cobrem Fastify CORS + S3 CORS + CloudFront

---

## Phase 6: Testes

**Purpose**: Validar que admin API funciona end-to-end

- [ ] T10 **[M] [US1]** Testes para admin endpoints (pode ser manual via curl ou automatizado):
  - Testar auth: sem header → 401, key errada → 401, key correta → 200/201
  - Testar CRUD: criar tenant, listar, gerar key, listar keys, revogar key
  - Testar validacao: slug invalido → 422, slug duplicado → 409, tenant nao existe → 404
  - Testar isolamento: API key de tenant NAO autentica em /admin → 401
  - Testar key revogada: revogar key, tentar usar → 401

**Checkpoint**: Todos os cenarios da spec passam

---

## Dependencies & Execution Order

```
Phase 1 (Shared) ──► Phase 2 (Admin Auth) ──► Phase 3 (Admin Routes) ──► Phase 6 (Testes)
                                                        │
Phase 4 (CORS Docs) ◄── independente, pode rodar em paralelo
Phase 5 (S3 CORS)   ◄── independente, pode rodar em paralelo
```

### Parallel Opportunities

- **T01, T02, T03** (Phase 1) sao sequenciais (T03 depende de T02)
- **T04** (Phase 2) depende de T01 (precisa ADMIN_KEY no env)
- **T05** (Phase 3) depende de T02 + T04
- **T06** depende de T05
- **T07, T08, T09** (Phases 4-5) sao independentes — podem rodar em paralelo com tudo
- **T10** (Phase 6) depende de T06

### Estimated Effort

| Phase | Tasks | Effort | Complexity |
|-------|-------|--------|-----------|
| Phase 1: Shared Layer | T01-T03 | 2h | S |
| Phase 2: Admin Auth | T04 | 1.5h | M |
| Phase 3: Admin Routes | T05-T06 | 4h | L |
| Phase 4: CORS Docs | T07 | 0.5h | S |
| Phase 5: S3 CORS | T08-T09 | 2h | M |
| Phase 6: Testes | T10 | 2h | M |
| **Total** | **10 tasks** | **~12h** | **M** |

---

## Notes

- Nenhuma migration de banco necessaria — tabelas `tenants` e `api_keys` ja existem com todos os campos necessarios
- Functions `createTenant()`, `generateApiKey()`, `createApiKey()` ja existem no shared — reutilizar
- O middleware `requireAuth` existente NAO deve ser modificado — admin auth e completamente separada
- Admin endpoints nao setam `request.tenant` — admin opera acima do conceito de tenant
- A Admin Key nao e armazenada no banco — e uma env var comparada em runtime
