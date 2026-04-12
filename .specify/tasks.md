# Tasks: Media Hub

**Input**: `.specify/plan.md`, `.specify/spec.md`, `.specify/constitution.md`
**Prerequisites**: All spec documents approved

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Complexity: S (< 1h), M (1-3h), L (3-8h), XL (8h+)

---

## Phase 1: Setup (Project Scaffolding)

**Purpose**: Initialize monorepo, configure tooling, create development environment

- [ ] T001 **[M]** Initialize pnpm monorepo: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` with strict mode, path aliases for `@media-hub/shared`
- [ ] T002 **[P] [S]** Create `packages/api/package.json` with Fastify 5, @fastify/multipart, @fastify/cors dependencies and `tsconfig.json` extending base
- [ ] T003 **[P] [S]** Create `packages/worker/package.json` with BullMQ 5, fluent-ffmpeg, Sharp dependencies and `tsconfig.json` extending base
- [ ] T004 **[P] [S]** Create `shared/package.json` with pg, @aws-sdk/client-s3, @aws-sdk/lib-storage, Zod dependencies and `tsconfig.json` extending base
- [ ] T005 **[P] [S]** Configure ESLint + Prettier at root level with TypeScript rules, add `.eslintrc.cjs` and `.prettierrc`
- [ ] T006 **[P] [S]** Create `.env.example` with all environment variables documented
- [ ] T007 **[M]** Create `docker-compose.yml` for local dev: PostgreSQL 16, Redis 7, API (hot-reload), Worker (hot-reload), volumes for node_modules
- [ ] T008 **[P] [S]** Create `.gitignore` (node_modules, dist, .env, *.log, tmp/)
- [ ] T009 **[P] [S]** Configure Vitest at root level with workspace config for all packages

**Checkpoint**: `pnpm install` works, `pnpm build` compiles all packages, `docker-compose up` starts all services

---

## Phase 2: Foundational (Shared Infrastructure)

**Purpose**: Database, S3, Redis clients and core types that ALL user stories depend on

**CRITICAL**: No user story can begin until this phase is complete

- [ ] T010 **[M]** Implement `shared/config/env.ts` — Zod schema for all env vars with defaults and validation. Export typed config singleton
- [ ] T011 **[L] [US1,US2,US3]** Implement `shared/db/client.ts` — pg Pool with connection config from env, health check method, graceful shutdown
- [ ] T012 **[L] [US1,US2,US3]** Create `shared/db/migrations/001_initial.sql` — full DDL (tenants, api_keys, uploads, files tables + indexes). Create migration runner script
- [ ] T013 **[P] [M]** Implement `shared/types/tenant.ts` — Zod schemas: `TenantCreate`, `TenantRow`, `TenantResponse`
- [ ] T014 **[P] [M]** Implement `shared/types/api-key.ts` — Zod schemas: `ApiKeyCreate`, `ApiKeyRow`, `ApiKeyResponse` (never expose hash)
- [ ] T015 **[P] [M]** Implement `shared/types/upload.ts` — Zod schemas: `UploadCreate`, `UploadRow`, `UploadResponse`, `UploadStatus` enum
- [ ] T016 **[P] [M]** Implement `shared/types/file.ts` — Zod schemas: `FileRow`, `FileResponse`, `FileStatus` enum, `MediaType` enum (video, image, audio, generic), `ProcessedUrls` type
- [ ] T017 **[P] [S]** Implement `shared/types/webhook.ts` — Zod schemas: `WebhookPayload`, `WebhookFileResult`
- [ ] T018 **[P] [S]** Create `shared/types/index.ts` — barrel export of all types
- [ ] T019 **[M]** Implement `shared/s3/client.ts` — S3Client singleton from env config, head bucket health check
- [ ] T020 **[M]** Implement `shared/s3/paths.ts` — functions: `rawKey(tenantId, uploadId, fileId, ext)`, `processedPrefix(tenantId, uploadId, fileId, mediaType)`, all under `S3_PREFIX/`
- [ ] T021 **[L]** Implement `shared/db/queries/tenants.ts` — `create`, `findBySlug`, `findById`, `update`, `deactivate`, `list`. All queries include tenant isolation where applicable
- [ ] T022 **[L]** Implement `shared/db/queries/api-keys.ts` — `create`, `findByHash`, `revokeById`, `listByTenant`, `countActiveByTenant`. Index on key_hash
- [ ] T023 **[L]** Implement `shared/db/queries/uploads.ts` — `create`, `findById`, `findByIdAndTenant`, `updateStatus`, `listByTenant`
- [ ] T024 **[L]** Implement `shared/db/queries/files.ts` — `create`, `findById`, `findByIdAndTenant`, `findByUpload`, `updateStatus`, `updateProcessedUrls`, `deleteById`, `countByUploadAndStatus`

**Checkpoint**: All shared types compile, DB client connects, migration runs, S3 client connects, all query functions export correctly

---

## Phase 3: User Story 3 - Tenant Management & API Key Rotation (Priority: P1)

**Goal**: Admin can create tenants and manage API keys — prerequisite for all auth-dependent stories

**Independent Test**: Create tenant via admin API, generate key, verify key works for auth

### Implementation

- [ ] T025 **[L] [US3]** Implement `packages/api/src/plugins/auth.ts` — Fastify plugin: extract Bearer token, SHA-256 hash, query api_keys + join tenants, inject `request.tenant` (id, slug, scopes), handle 401/403. Support `admin:*` scope for admin endpoints
- [ ] T026 **[M] [US3]** Implement `packages/api/src/plugins/tenant-context.ts` — Fastify decorator adding tenant to request type, TypeScript augmentation for FastifyRequest
- [ ] T027 **[M] [US3]** Implement `packages/api/src/plugins/error-handler.ts` — Centralized error handling: Zod validation errors → 400, auth errors → 401/403, not found → 404, conflict → 409, internal → 500 with sanitized message
- [ ] T028 **[L] [US3]** Implement `packages/api/src/services/key.service.ts` — `generateKey(tenantSlug)` returns `mh_{slug}_{random32hex}`, `hashKey(raw)` returns SHA-256, `createKey(tenantId, scopes, label)` stores hash + returns raw (once), `revokeKey(keyId, tenantId)`, `validateMaxKeys(tenantId)` enforces 2-key limit
- [ ] T029 **[L] [US3]** Implement `packages/api/src/routes/admin/tenants.ts` — `POST /v1/admin/tenants` (create), `GET /v1/admin/tenants` (list), `GET /v1/admin/tenants/:id` (detail), `PUT /v1/admin/tenants/:id` (update), `DELETE /v1/admin/tenants/:id` (deactivate). All require `admin:tenants` scope
- [ ] T030 **[L] [US3]** Implement `packages/api/src/routes/admin/keys.ts` — `POST /v1/admin/tenants/:id/keys` (create, returns raw key once), `GET /v1/admin/tenants/:id/keys` (list, no hashes), `DELETE /v1/admin/keys/:id` (revoke). Enforce 2-key limit on create
- [ ] T031 **[M] [US3]** Implement `packages/api/src/server.ts` — Fastify app factory: register plugins (auth, error-handler, cors, multipart), register routes, graceful shutdown, health routes
- [ ] T032 **[S] [US3]** Implement `packages/api/src/index.ts` — Entry point: load env, create server, listen on port
- [ ] T033 **[M] [US3]** Create `scripts/seed-tenant.ts` — Dev script: create test tenant `dev-test`, generate API key, print to stdout. Uses shared/db directly
- [ ] T034 **[L] [US3]** Write tests: tenant CRUD + API key lifecycle + auth plugin + 2-key limit + scope enforcement

**Checkpoint**: Can create tenant, generate key, authenticate requests, rotate keys. Admin API fully functional

---

## Phase 4: User Story 1 - Single File Upload & Processing (Priority: P1)

**Goal**: Upload one file, have it processed, receive webhook callback with processed URLs

**Independent Test**: Upload MP4 → verify HLS files in S3, upload JPEG → verify WebP in S3

### Implementation — API Side

- [ ] T035 **[L] [US1]** Implement `packages/api/src/services/upload.service.ts` — `createUpload(tenantId, body)` creates upload row, `getUpload(uploadId, tenantId)` returns upload + files, `streamFileToS3(uploadId, tenantId, multipartFile)` streams directly to S3 via @aws-sdk/lib-storage Upload, inserts file row, returns file record
- [ ] T036 **[L] [US1]** Implement `packages/api/src/services/file.service.ts` — `getFile(fileId, tenantId)`, `deleteFile(fileId, tenantId)` removes S3 objects (raw + processed prefix) + DB row, `enqueueProcessing(file)` adds BullMQ job with `{ fileId, tenantId, uploadId, mediaType, s3KeyRaw }`
- [ ] T037 **[L] [US1]** Implement `packages/api/src/routes/uploads.ts` — `POST /v1/uploads` (create upload session, requires `media:upload`), `GET /v1/uploads/:id` (get upload + files, requires `media:read`)
- [ ] T038 **[L] [US1]** Implement `packages/api/src/routes/files.ts` — `POST /v1/uploads/:id/files` (multipart upload, stream to S3, enqueue processing, requires `media:upload`), `GET /v1/files/:id` (requires `media:read`), `DELETE /v1/files/:id` (requires `media:delete`)

### Implementation — Worker Side

- [ ] T039 **[M] [US1]** Implement `packages/worker/src/queues.ts` — Define BullMQ queue `media-processing`, connection config, default job options (attempts: 3, backoff: exponential)
- [ ] T040 **[M] [US1]** Implement `packages/worker/src/utils/s3-stream.ts` — `downloadToTempFile(s3Key)` returns temp file path, `uploadFromFile(localPath, s3Key, contentType)`, `uploadFromBuffer(buffer, s3Key, contentType)`, `deletePrefix(prefix)` for cleanup
- [ ] T041 **[XL] [US1]** Implement `packages/worker/src/services/ffmpeg.service.ts` — `probeResolution(filePath)` returns width/height, `generateHLS(filePath, outputDir, maxResolution)` generates multi-resolution HLS (360p/720p/1080p/4K, only <= source), creates master.m3u8, `generateThumbnail(filePath, outputPath)` extracts frame as WebP. Use fluent-ffmpeg with promise wrappers
- [ ] T042 **[L] [US1]** Implement `packages/worker/src/services/sharp.service.ts` — `convertToWebP(inputBuffer, quality)` returns WebP buffer, `generateThumbnails(inputBuffer, widths[])` returns array of `{ width, buffer }`, all output as WebP
- [ ] T043 **[L] [US1]** Implement `packages/worker/src/processors/video.processor.ts` — Download from S3 → probe → generateHLS → generateThumbnail → upload all to S3 processed path → update DB with processed_urls → cleanup temp files
- [ ] T044 **[M] [US1]** Implement `packages/worker/src/processors/image.processor.ts` — Download from S3 → convertToWebP → generateThumbnails(320, 720) → upload to S3 → update DB
- [ ] T045 **[M] [US1]** Implement `packages/worker/src/processors/audio.processor.ts` — Download from S3 → FFmpeg normalize to MP3 192k → upload to S3 → update DB
- [ ] T046 **[S] [US1]** Implement `packages/worker/src/processors/generic.processor.ts` — Set s3_key_processed = s3_key_raw, update status to completed immediately
- [ ] T047 **[L] [US1]** Implement `packages/worker/src/services/callback.service.ts` — `sendWebhook(upload)` builds payload, signs with HMAC-SHA256 if callback_secret exists, POSTs to callback_url, retries 3x (1s, 10s, 60s)
- [ ] T048 **[L] [US1]** Implement `packages/worker/src/index.ts` — Worker entry point: create BullMQ Worker, route jobs by mediaType to correct processor, on job complete check if all files in upload are done → trigger webhook, graceful shutdown
- [ ] T049 **[L] [US1]** Write tests: upload flow (API), each processor (unit with mocked S3/FFmpeg), callback service, media type detection

**Checkpoint**: Can upload single file of any type, processing happens automatically, webhook fires with correct URLs

---

## Phase 5: User Story 2 - Batch Upload with Parallel Processing (Priority: P1)

**Goal**: Upload multiple files in one session, all process in parallel, single webhook when complete

**Independent Test**: Upload 5 files (mix of types), verify all process, receive one webhook

### Implementation

- [ ] T050 **[M] [US2]** Extend `packages/api/src/services/upload.service.ts` — `incrementFilesCount(uploadId)` atomic increment on each file upload. The upload's `files_count` tracks expected total
- [ ] T051 **[M] [US2]** Extend `packages/worker/src/index.ts` — After each job completes, query `countByUploadAndStatus(uploadId)`. If all files are terminal (completed/failed), determine upload status (`completed` if all pass, `partial` if any failed) and trigger webhook
- [ ] T052 **[M] [US2]** Extend `packages/api/src/routes/uploads.ts` — `GET /v1/uploads/:id` response includes all files with individual status, overall upload status, counts (total, completed, failed, processing)
- [ ] T053 **[L] [US2]** Write tests: batch upload with mixed media types, partial failure scenario, webhook payload with multiple files, concurrent file upload to same upload_id

**Checkpoint**: Batch upload works end-to-end. Partial failures don't block other files. Single webhook summarizes all results

---

## Phase 6: User Story 4 & 5 - File Status, Retrieval & Deletion (Priority: P2)

**Goal**: Clients can poll file/upload status and delete files they no longer need

**Independent Test**: Upload file, poll until complete, verify URLs, delete file, verify 404

### Implementation

- [ ] T054 **[M] [US4]** Extend `GET /v1/files/:id` response to include full `processed_urls` breakdown by variant (master.m3u8, thumbnails, etc.)
- [ ] T055 **[M] [US5]** Implement `DELETE /v1/files/:id` logic in `file.service.ts` — verify file belongs to tenant, check not processing (409 if so), delete S3 raw key, delete S3 processed prefix (all variants), delete DB row
- [ ] T056 **[M] [US4,US5]** Write tests: file retrieval with full URLs, deletion (S3 + DB), tenant isolation on delete (404 not 403), conflict when deleting processing file

**Checkpoint**: Full CRUD cycle for files works. Deletion cleans up S3 and DB

---

## Phase 7: User Story 6 - Health Check & Observability (Priority: P2)

**Goal**: Operations team can monitor service health and dependency status

### Implementation

- [ ] T057 **[M] [US6]** Implement `packages/api/src/routes/health.ts` — `GET /v1/health/auth` (authenticated): check PostgreSQL connection (SELECT 1), Redis PING, S3 HeadBucket. Return individual dependency status. 200 if all OK, 503 if any degraded
- [ ] T058 **[S] [US6]** Add structured JSON logging (pino, Fastify's default) with request_id, tenant_id, upload_id correlation
- [ ] T059 **[S] [US6]** Write tests: health endpoint with all deps up, health with one dep down (mocked)

**Checkpoint**: Health endpoint functional, logs are structured and correlated

---

## Phase 8: User Story 7 & 8 - Webhook Security & Presigned URLs (Priority: P3)

**Goal**: Production-grade webhook verification and secure direct file access

### Implementation

- [ ] T060 **[M] [US7]** Implement HMAC-SHA256 signing in `callback.service.ts` — include timestamp + body hash in signature header. Document verification algorithm in integration guide
- [ ] T061 **[M] [US8]** Implement `GET /v1/files/:id/url?ttl=3600` — generate S3 presigned URL with configurable TTL (default 1h, max 24h), requires `media:read` scope
- [ ] T062 **[M] [US7,US8]** Write tests: webhook signature verification, presigned URL generation, TTL enforcement

**Checkpoint**: Webhooks are cryptographically verifiable. Files accessible via time-limited URLs

---

## Phase 9: Docker & Deploy

**Purpose**: Production-ready Docker images and Swarm stack

- [ ] T063 **[L]** Create `packages/api/Dockerfile` — Multi-stage: builder (node:22-alpine, pnpm install, build) → runner (node:22-alpine, copy dist + node_modules). Target < 200MB
- [ ] T064 **[L]** Create `packages/worker/Dockerfile` — Multi-stage: builder (node:22-alpine, pnpm install, build) → runner (node:22-alpine + ffmpeg, copy dist + node_modules). Target < 500MB. Install FFmpeg via `apk add ffmpeg`
- [ ] T065 **[M]** Create `stack.yml` — Docker Swarm stack: `media-hub_api` (2 replicas, port 3000), `media-hub_worker` (2 replicas, no ports), shared secrets for env vars, Traefik labels for HTTPS routing, health checks, deploy constraints
- [ ] T066 **[S]** Create GitHub Actions CI: lint → type-check → test → build → push images to Digital AI Docker Registry
- [ ] T067 **[M]** Write deploy documentation in `docs/deploy.md` — Swarm deploy, env setup, database migration, first tenant creation

**Checkpoint**: `docker stack deploy -c stack.yml media-hub` creates a running production system

---

## Phase 10: Polish & Cross-Cutting

**Purpose**: Final quality improvements

- [ ] T068 **[P] [S]** Add rate limiting plugin to Fastify (per tenant, per IP)
- [ ] T069 **[P] [S]** Add request validation with Zod schemas for all route inputs
- [ ] T070 **[P] [M]** Add comprehensive error messages with error codes (MH-001, MH-002, etc.)
- [ ] T071 **[P] [S]** Security audit: verify no SQL injection, no tenant leaks, no credential exposure in logs
- [ ] T072 **[S]** Final integration test: full lifecycle (create tenant → generate key → upload batch → process → webhook → delete)
- [ ] T073 **[S]** Update `docs/integration-guide.md` with final API response schemas

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) ─────────────────────► Phase 2 (Foundational)
                                              │
                                              ▼
                                       Phase 3 (Tenants + Auth) ──► Phase 4 (Single Upload)
                                                                          │
                                                                          ▼
                                                                   Phase 5 (Batch Upload)
                                                                          │
                                                                   ┌──────┴──────┐
                                                                   ▼             ▼
                                                            Phase 6         Phase 7
                                                         (Status/Delete)  (Health)
                                                                   │             │
                                                                   └──────┬──────┘
                                                                          ▼
                                                                   Phase 8 (Security)
                                                                          │
                                                                          ▼
                                                                   Phase 9 (Docker)
                                                                          │
                                                                          ▼
                                                                   Phase 10 (Polish)
```

### Parallel Opportunities

- **Phase 1**: T002, T003, T004, T005, T006, T008, T009 can all run in parallel after T001
- **Phase 2**: T013-T018 (all types) can run in parallel. T021-T024 (all queries) can run in parallel after T011-T012
- **Phase 3**: T025-T027 (plugins) partially parallel. T029-T030 (routes) after T028 (service)
- **Phase 4**: T037-T038 (API routes) parallel with T039-T048 (Worker), since they communicate via Redis
- **Phase 6 & 7**: Can run in parallel with each other (independent stories)
- **Phase 9**: T063-T064 (Dockerfiles) in parallel

### Estimated Total Effort

| Phase | Effort | Complexity |
|-------|--------|-----------|
| Phase 1: Setup | 4h | S |
| Phase 2: Foundational | 12h | L |
| Phase 3: Tenant/Auth | 10h | L |
| Phase 4: Single Upload | 20h | XL |
| Phase 5: Batch Upload | 6h | M |
| Phase 6: Status/Delete | 4h | M |
| Phase 7: Health | 3h | S |
| Phase 8: Security | 4h | M |
| Phase 9: Docker/Deploy | 8h | L |
| Phase 10: Polish | 4h | S |
| **Total** | **~75h** | **XL** |

---

## Notes

- Tasks marked [P] = different files, safe to parallelize
- Commit after each task or logical group
- Phase 4 (Video Processing) is the highest-risk phase — FFmpeg integration is complex. Start early, test with real video files
- The Worker Dockerfile is tricky: Alpine + FFmpeg + Sharp native deps. Test image build early (T064)
- S3 streaming is critical path — validate @aws-sdk/lib-storage Upload works with Fastify multipart streams in Phase 4
