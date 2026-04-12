# Media Hub Constitution

## Vision

Media Hub is a **multi-tenant, platform-agnostic media upload and processing service** that provides any Digital AI platform with scalable file management, adaptive video streaming (HLS), image optimization, and audio normalization — all behind a simple REST API authenticated via API Keys.

**Core mission**: Be the single source of truth for media assets across all Digital AI products, handling upload, processing, storage, and delivery with zero coupling to any specific frontend or business domain.

## Core Principles

### I. Tenant Isolation (NON-NEGOTIABLE)

Every operation is scoped to a tenant. No cross-tenant data access is possible at any layer — API, database, storage. Tenant context is derived from the API Key and propagated through every function call, queue job, and S3 path. There are no shared namespaces.

### II. Stream-First

Files are never buffered entirely in memory. Uploads stream directly from the HTTP request to S3 via multipart upload. Processing workers stream from S3 to FFmpeg/Sharp and back to S3. This enables handling files of any size without memory constraints.

### III. Agnostic Service

Media Hub has zero knowledge of what platform consumes it. It does not know about Typebot, Chatwoot, Julia, or any other product. Clients authenticate via API Key, upload files, and receive webhook callbacks. The service boundary is the REST API — nothing more.

### IV. Separation of Concerns: API vs Worker

The API server handles HTTP requests, authentication, file metadata, and S3 raw uploads. Processing happens exclusively in BullMQ workers running in a separate container. This separation allows independent scaling — more workers for processing-heavy loads, more API instances for upload-heavy loads.

### V. Adaptive Processing

Video processing follows the YouTube model: generate HLS adaptive bitrate streams at multiple resolutions (360p, 720p, 1080p, 4K) based on the original file's resolution. Never upscale. Images are converted to WebP with responsive thumbnails. Audio is normalized to MP3 192k. Generic files pass through without processing.

### VI. Idempotent & Resilient

Every processing job is idempotent — reprocessing the same file produces the same output. Failed jobs are retried with exponential backoff (3 attempts). Partial failures in a batch upload do not affect other files. The system recovers gracefully from crashes.

### VII. Security by Default

API Keys are stored as SHA-256 hashes only — the raw key is shown once at creation and never again. Webhook callbacks are signed with HMAC-SHA256 + timestamp to prevent replay attacks. S3 objects are private by default; access is through presigned URLs or CDN with signed cookies.

## Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **API** | Node.js + Fastify (TypeScript) | High-performance HTTP, native streaming, excellent TS support |
| **Queue** | BullMQ + Redis | Reliable job queue with retries, priorities, rate limiting |
| **Video** | FFmpeg (H.264, HLS) | Industry standard, adaptive bitrate streaming |
| **Image** | Sharp (libvips) | Fastest Node.js image processing library |
| **Storage** | AWS S3 | Scalable object storage, CloudFront CDN integration |
| **Database** | PostgreSQL | ACID compliance, JSONB for flexible metadata |
| **Deploy** | Docker Swarm | Two distinct services: `api` and `worker` |
| **Monorepo** | pnpm workspaces | Shared types and DB layer between packages |

## Key Architectural Decisions

1. **API Key over JWT**: Simpler for service-to-service auth; no token refresh complexity; supports key rotation with 2 active keys per tenant
2. **BullMQ over Celery/RabbitMQ**: Native Node.js, Redis-backed, excellent TypeScript support, simpler ops than RabbitMQ
3. **HLS over DASH**: Better device compatibility (especially iOS/Safari), simpler CDN caching
4. **Monorepo over separate repos**: Shared types (Zod schemas) and DB layer between API and Worker, single CI/CD pipeline
5. **PostgreSQL over Supabase**: Dedicated database for media-hub; no shared resources with other projects; full control over schema and migrations
6. **WebP as default image format**: ~30% smaller than JPEG at equivalent quality, universal browser support

## Non-Goals (What Media Hub Does NOT Do)

1. **No CDN management**: Media Hub stores files in S3. CDN (CloudFront) configuration is infrastructure-level, not application-level
2. **No user authentication**: Media Hub authenticates *tenants* (machines), not end-users. User auth is the client's responsibility
3. **No content moderation**: The service does not scan, filter, or moderate uploaded content
4. **No frontend/UI**: This is a headless API service. No admin panel, no upload widget, no player
5. **No transcoding presets management**: Processing profiles are hardcoded per media type. No custom transcoding configurations per tenant (yet)
6. **No billing/metering**: No storage quotas, bandwidth tracking, or usage billing. Future consideration
7. **No real-time streaming**: This is upload-and-process, not live streaming (RTMP/WebRTC)

## Quality Gates

- All endpoints must have integration tests
- Processing workers must have unit tests for each media type
- TypeScript strict mode (`strict: true`) in all packages
- ESLint + Prettier enforced via pre-commit hooks
- No `any` types except at system boundaries (FFmpeg subprocess output)
- Docker images must be Alpine-based, target < 200MB for API, < 500MB for Worker (FFmpeg)

## Governance

This constitution is the authoritative source for all architectural decisions in Media Hub. Any deviation must be documented in `gotchas.md` with justification. Amendments require explicit approval from the project owner.

**Version**: 1.0.0 | **Ratified**: 2026-04-12 | **Last Amended**: 2026-04-12
