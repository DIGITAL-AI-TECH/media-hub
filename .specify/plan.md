# Implementation Plan: Media Hub

**Date**: 2026-04-12 | **Spec**: `.specify/spec.md` | **Constitution**: `.specify/constitution.md`

## Summary

Media Hub is a multi-tenant media upload and processing service built as a Node.js monorepo with two deployment units (API + Worker). Files are streamed to S3, processing jobs dispatched via BullMQ, and results delivered via webhook callbacks. The architecture separates HTTP concerns (Fastify) from processing concerns (FFmpeg/Sharp workers) for independent scaling.

## Technical Context

**Language/Version**: Node.js 22 LTS, TypeScript 5.x (strict mode)
**Primary Dependencies**: Fastify 5, BullMQ 5, Sharp, fluent-ffmpeg, @aws-sdk/client-s3, pg (node-postgres), Zod
**Storage**: PostgreSQL (dedicated `media_hub` database), AWS S3, Redis 7
**Testing**: Vitest (unit + integration), supertest (API tests)
**Target Platform**: Linux (Docker Swarm on AWS EC2)
**Project Type**: Monorepo (pnpm workspaces) with 2 packages + shared lib
**Performance Goals**: 50 concurrent uploads, p95 < 50ms for non-upload endpoints, video processing < 3min for 2min 1080p
**Constraints**: Stream-first (no full-file buffering), Alpine Docker images, Worker image < 500MB (FFmpeg), API image < 200MB
**Scale/Scope**: Initially 5-10 tenants, hundreds of files/day, growing to thousands

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Tenant Isolation | PASS | All queries scoped by tenant_id, S3 paths prefixed |
| Stream-First | PASS | @aws-sdk/lib-storage for multipart, no buffer |
| API/Worker Separation | PASS | Two distinct packages, two Docker services |
| Idempotent Processing | PASS | Same input = same output, job IDs prevent duplicates |
| Security by Default | PASS | SHA-256 key storage, HMAC webhooks, no public S3 |

## Project Structure

### Source Code (repository root)

```text
media-hub/
├── packages/
│   ├── api/                          # Fastify HTTP server
│   │   ├── src/
│   │   │   ├── server.ts             # Fastify app factory
│   │   │   ├── index.ts              # Entry point
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts           # API Key authentication plugin
│   │   │   │   ├── tenant-context.ts # Tenant injection into request
│   │   │   │   └── error-handler.ts  # Centralized error handling
│   │   │   ├── routes/
│   │   │   │   ├── health.ts         # GET /v1/health/auth
│   │   │   │   ├── uploads.ts        # POST /v1/uploads, GET /v1/uploads/:id
│   │   │   │   ├── files.ts          # POST /v1/uploads/:id/files, GET/DELETE /v1/files/:id
│   │   │   │   └── admin/
│   │   │   │       ├── tenants.ts    # Tenant CRUD
│   │   │   │       └── keys.ts       # API Key management
│   │   │   └── services/
│   │   │       ├── upload.service.ts # Upload business logic
│   │   │       ├── file.service.ts   # File business logic
│   │   │       └── key.service.ts    # API Key generation & validation
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── worker/                       # BullMQ processing workers
│       ├── src/
│       │   ├── index.ts              # Worker entry point
│       │   ├── queues.ts             # Queue definitions & config
│       │   ├── processors/
│       │   │   ├── video.processor.ts    # FFmpeg HLS pipeline
│       │   │   ├── image.processor.ts    # Sharp WebP + thumbnails
│       │   │   ├── audio.processor.ts    # FFmpeg MP3 normalization
│       │   │   └── generic.processor.ts  # No-op (just mark complete)
│       │   ├── services/
│       │   │   ├── ffmpeg.service.ts     # FFmpeg command builder
│       │   │   ├── sharp.service.ts      # Sharp transformation builder
│       │   │   └── callback.service.ts   # Webhook dispatch + HMAC signing
│       │   └── utils/
│       │       └── s3-stream.ts          # S3 download/upload streaming helpers
│       ├── Dockerfile                    # Alpine + FFmpeg
│       ├── package.json
│       └── tsconfig.json
│
├── shared/
│   ├── types/                        # Zod schemas (shared between API & Worker)
│   │   ├── tenant.ts
│   │   ├── upload.ts
│   │   ├── file.ts
│   │   ├── api-key.ts
│   │   ├── webhook.ts
│   │   └── index.ts
│   ├── db/                           # PostgreSQL client + queries
│   │   ├── client.ts                 # pg Pool singleton
│   │   ├── migrations/
│   │   │   └── 001_initial.sql       # DDL from spec
│   │   ├── queries/
│   │   │   ├── tenants.ts
│   │   │   ├── api-keys.ts
│   │   │   ├── uploads.ts
│   │   │   └── files.ts
│   │   └── index.ts
│   ├── s3/                           # S3 client + path helpers
│   │   ├── client.ts                 # S3Client singleton
│   │   └── paths.ts                  # S3 key generation per tenant/upload/file
│   ├── config/                       # Environment configuration
│   │   └── env.ts                    # Zod-validated env vars
│   ├── package.json
│   └── tsconfig.json
│
├── docs/
│   └── integration-guide.md          # Client integration documentation
│
├── scripts/
│   └── seed-tenant.ts                # Dev script to create test tenant + key
│
├── docker-compose.yml                # Local dev (API + Worker + Postgres + Redis)
├── stack.yml                         # Docker Swarm production
├── package.json                      # Root monorepo config
├── pnpm-workspace.yaml
├── tsconfig.base.json                # Shared TS config
├── .env.example
└── .gitignore
```

**Structure Decision**: Monorepo with pnpm workspaces. Three packages: `packages/api`, `packages/worker`, `shared`. The `shared` package is not deployed independently — it's consumed by both API and Worker at build time via TypeScript path aliases.

## Component Architecture

### Data Flow

```
Client → [HTTPS] → Fastify API → [Auth Plugin] → Route Handler
                                                      │
                         ┌────────────────────────────┘
                         ▼
              ┌─────────────────────┐
              │   Upload Service     │
              │  1. Create upload    │
              │  2. Stream to S3     │
              │  3. Insert file row  │
              │  4. Enqueue BullMQ   │
              └──────────┬──────────┘
                         │ Redis (BullMQ)
                         ▼
              ┌─────────────────────┐
              │   Worker Container   │
              │  1. Dequeue job      │
              │  2. Download from S3 │
              │  3. Process (FFmpeg/ │
              │     Sharp/generic)   │
              │  4. Upload to S3     │
              │  5. Update DB status │
              │  6. Check if upload  │
              │     complete         │
              │  7. Send webhook     │
              └─────────────────────┘
```

### Processing Pipeline per Media Type

**Video** (`video/*`):
1. Download raw from S3 to temp file
2. Probe resolution with ffprobe
3. Generate HLS variants (only resolutions <= source): 360p, 720p, 1080p, 4K
4. Generate master.m3u8 referencing all variant playlists
5. Generate thumbnail (WebP, from frame at 1s or 25%)
6. Upload all segments + manifests to S3 `processed/{upload_id}/{file_id}/video/`
7. Update `processed_urls` JSONB with manifest URLs

**Image** (`image/*`):
1. Download raw from S3 to buffer (images are small enough)
2. Convert to WebP (quality 80)
3. Generate thumb_320 (320px width, WebP)
4. Generate thumb_720 (720px width, WebP)
5. Upload to S3 `processed/{upload_id}/{file_id}/image/`
6. Update `processed_urls` JSONB

**Audio** (`audio/*`):
1. Download raw from S3 to temp file
2. Normalize to MP3 192kbps via FFmpeg (`-codec:a libmp3lame -b:a 192k`)
3. Upload to S3 `processed/{upload_id}/{file_id}/audio/audio.mp3`
4. Update `processed_urls` JSONB

**Generic** (everything else):
1. No processing
2. Set `s3_key_processed = s3_key_raw`
3. Update status to `completed` immediately

### Authentication Flow

```
Request → Extract "Authorization: Bearer mh_..." header
        → SHA-256 hash the key
        → SELECT api_keys WHERE key_hash = $1 AND revoked_at IS NULL
        → JOIN tenants WHERE is_active = TRUE
        → Check scopes against required scope for endpoint
        → Inject tenant context into request (tenant_id, scopes)
        → Update last_used_at async (non-blocking)
```

### Webhook Callback Flow

```
All files in upload complete (or failed)?
  → Build payload: { upload_id, status, files: [...] }
  → If callback_secret:
      → timestamp = Date.now()
      → signature = HMAC-SHA256(timestamp + "." + JSON.stringify(body), callback_secret)
      → Headers: X-MediaHub-Signature, X-MediaHub-Timestamp
  → POST to callback_url
  → Retry on failure: 1s, 10s, 60s (3 attempts)
```

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| FFmpeg OOM on large video | Worker crash | Medium | Set `--max-old-space-size`, use temp files not buffers, monitor memory |
| S3 rate limiting | Upload failures | Low | Implement retry with backoff, use multipart upload |
| Redis failure | Queue stalls | Low | API continues accepting uploads to S3; jobs enqueue when Redis recovers |
| Tenant data leak | Security breach | Low | SQL queries always include `WHERE tenant_id = $1`, integration tests verify isolation |
| BullMQ job loss on worker crash | Files stuck in processing | Medium | BullMQ `autorun: false` + `lockDuration: 300000`, stalled jobs auto-retry |
| Large batch (100+ files) overwhelming worker | Processing backlog | Medium | BullMQ concurrency limit per worker, priority queues for small files |

## Dependencies

| Dependency | Required By | Notes |
|------------|-------------|-------|
| PostgreSQL database | All | Create `media_hub` database, run migration |
| Redis 7 | Worker, API (optional health check) | Existing Redis in Docker Swarm |
| AWS S3 bucket | All | `aws-digital-ai` credential, `media-hub/` prefix |
| FFmpeg 6+ | Worker | Must include libx264, libmp3lame |
| Docker Swarm | Deploy | Two services: `media-hub_api`, `media-hub_worker` |
| CloudFront (optional) | Delivery | Not required for MVP, can be added later |

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/media_hub

# Redis
REDIS_URL=redis://host:6379

# AWS S3
S3_BUCKET=your-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_PREFIX=media-hub

# API
API_PORT=3000
API_HOST=0.0.0.0
ADMIN_API_KEY=sha256-of-admin-key

# Worker
WORKER_CONCURRENCY=3
WORKER_MAX_RETRIES=3

# General
NODE_ENV=production
LOG_LEVEL=info
```
