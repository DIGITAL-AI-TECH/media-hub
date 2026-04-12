# Feature Specification: Media Hub

**Created**: 2026-04-12
**Status**: Approved
**Input**: User brief + technical research + legacy codebase analysis

## User Scenarios & Testing

### User Story 1 - Single File Upload & Processing (Priority: P1)

As a client platform, I upload a single file (image, video, audio, or generic) to Media Hub and receive a webhook callback when processing is complete, with URLs for all processed variants.

**Why this priority**: This is the fundamental operation. Without single file upload and processing, nothing else works. It validates the entire pipeline: auth, upload, S3 storage, queue dispatch, processing, callback.

**Independent Test**: Upload a video file via `POST /v1/uploads` + `POST /v1/uploads/:id/files`, wait for webhook callback, verify HLS manifests exist in S3 and are playable.

**Acceptance Scenarios**:

1. **Given** a valid API Key, **When** I create an upload and send a 50MB MP4 video, **Then** I receive `upload_id` immediately, file streams to S3, BullMQ job is created, and within 5 minutes I receive a webhook with HLS URLs (master.m3u8 + per-resolution playlists)
2. **Given** a valid API Key, **When** I upload a 5MB JPEG image, **Then** I receive a webhook with WebP URLs (original, thumb_320, thumb_720)
3. **Given** a valid API Key, **When** I upload an MP3 audio file, **Then** I receive a webhook with normalized MP3 URL (192k)
4. **Given** a valid API Key, **When** I upload a PDF (generic type), **Then** the file is stored as-is with a direct URL, no processing applied
5. **Given** an invalid API Key, **When** I attempt any upload, **Then** I receive 401 Unauthorized
6. **Given** a valid API Key without `media:upload` scope, **When** I attempt to upload, **Then** I receive 403 Forbidden

---

### User Story 2 - Batch Upload with Parallel Processing (Priority: P1)

As a client platform, I create a single upload session and send multiple files in parallel. Each file is processed independently, and I receive a single webhook when ALL files in the batch are complete.

**Why this priority**: Batch upload is a core differentiator. Clients like Julia Pipeline or Visual Creator need to upload 10-50 files at once. Without this, they'd need to orchestrate individual uploads themselves.

**Independent Test**: Create upload, send 5 files in parallel via concurrent `POST /v1/uploads/:id/files`, verify all 5 process independently, receive ONE webhook when all complete.

**Acceptance Scenarios**:

1. **Given** a valid API Key, **When** I create an upload with `callback_url` and send 5 files (2 videos, 2 images, 1 audio) in parallel, **Then** each file gets its own BullMQ job, processes independently, and I receive one webhook when `files_count` matches completed count
2. **Given** a batch of 10 files where 1 fails processing, **When** processing completes, **Then** the webhook reports `status: partial`, 9 files have `status: completed`, 1 has `status: failed` with `error_message`, and the other 9 files' URLs are fully usable
3. **Given** a batch upload in progress, **When** I query `GET /v1/uploads/:id`, **Then** I see real-time status of each file (pending, processing, completed, failed) with progress percentage where available

---

### User Story 3 - Tenant Management & API Key Rotation (Priority: P1)

As a platform administrator, I create tenants, generate API keys with specific scopes, and rotate keys without downtime.

**Why this priority**: Without tenants and API keys, no client can authenticate. Key rotation is critical for security operations. This is infrastructure for everything else.

**Independent Test**: Create tenant via admin API, generate 2 API keys, use first key to upload, rotate by revoking first key while second remains active, verify uploads still work with second key.

**Acceptance Scenarios**:

1. **Given** admin credentials, **When** I create a tenant with slug `julia-pipeline`, **Then** the tenant is created, S3 prefix `media-hub/julia-pipeline/` is implicitly ready (S3 doesn't need explicit folder creation), and I can generate API keys
2. **Given** a tenant with 1 active key, **When** I generate a second key, **Then** both keys work simultaneously. **When** I revoke the first key, **Then** only the second key works, zero downtime
3. **Given** a tenant with 2 active keys, **When** I try to generate a third, **Then** I receive 409 Conflict with message to revoke one first
4. **Given** admin credentials, **When** I create an API key with scopes `['media:upload', 'media:read']`, **Then** that key can upload and read but cannot delete files

---

### User Story 4 - File Status & Retrieval (Priority: P2)

As a client platform, I query the status of uploads and individual files, and retrieve processed URLs for rendering in my UI.

**Why this priority**: Clients need to poll status when webhooks are not configured or as a fallback. Essential for building UIs but not blocking for backend-to-backend integrations.

**Independent Test**: Upload a file, poll `GET /v1/uploads/:id` until complete, verify all processed URLs are accessible.

**Acceptance Scenarios**:

1. **Given** an upload with 3 files, **When** I call `GET /v1/uploads/:id`, **Then** I receive the upload object with all 3 files, each with their current status and processed URLs (if complete)
2. **Given** a completed file, **When** I call `GET /v1/files/:id`, **Then** I receive the file object with `processed_urls` containing all variant URLs (e.g., HLS manifests for video, WebP variants for images)
3. **Given** a file that is still processing, **When** I call `GET /v1/files/:id`, **Then** I receive `status: processing` with `processing_started_at` timestamp

---

### User Story 5 - File Deletion (Priority: P2)

As a client platform, I delete files I no longer need, freeing S3 storage and removing database records.

**Why this priority**: Storage management is important but not blocking for MVP launch. Tenants need to be able to clean up old files.

**Independent Test**: Upload a file, wait for processing, delete it via `DELETE /v1/files/:id`, verify S3 objects (raw + processed) are removed and database record is soft-deleted.

**Acceptance Scenarios**:

1. **Given** a completed file, **When** I call `DELETE /v1/files/:id` with `media:delete` scope, **Then** raw and processed S3 objects are deleted, database record is removed, and subsequent GET returns 404
2. **Given** a file belonging to tenant A, **When** tenant B attempts to delete it, **Then** 404 is returned (tenant isolation — don't reveal existence)
3. **Given** a file that is currently processing, **When** I attempt to delete it, **Then** I receive 409 Conflict with message to wait for processing to complete

---

### User Story 6 - Health Check & Observability (Priority: P2)

As an operations engineer, I monitor Media Hub's health, verify connectivity to dependencies (S3, Redis, PostgreSQL), and observe processing metrics.

**Why this priority**: Operational visibility is important for production but not blocking for initial development and testing.

**Independent Test**: Call `GET /v1/health/auth` with valid key, verify 200 response with dependency status.

**Acceptance Scenarios**:

1. **Given** all dependencies are healthy, **When** I call `GET /v1/health/auth`, **Then** I receive 200 with `{ status: "ok", dependencies: { s3: "ok", redis: "ok", postgres: "ok" } }`
2. **Given** Redis is down, **When** I call `GET /v1/health/auth`, **Then** I receive 503 with `{ status: "degraded", dependencies: { redis: "error" } }`

---

### User Story 7 - Webhook Security (Priority: P3)

As a client platform, I verify that webhook callbacks are authentic and not replayed, using HMAC-SHA256 signatures.

**Why this priority**: Security hardening. The webhook works without signature verification (US1), but production clients need to verify authenticity.

**Independent Test**: Configure upload with `callback_secret`, receive webhook, verify `X-MediaHub-Signature` header matches HMAC-SHA256 of body + timestamp.

**Acceptance Scenarios**:

1. **Given** an upload with `callback_secret`, **When** processing completes and webhook fires, **Then** the callback includes headers `X-MediaHub-Signature` (HMAC-SHA256) and `X-MediaHub-Timestamp` (Unix epoch), and the client can verify authenticity
2. **Given** a replayed webhook with old timestamp (> 5 minutes), **When** the client checks the timestamp, **Then** it can reject the replay

---

### User Story 8 - Presigned URL Access (Priority: P3)

As a client platform, I request time-limited presigned URLs for S3 objects, enabling secure direct access without exposing S3 credentials.

**Why this priority**: Future enhancement. Initial implementation can return S3 keys that clients resolve via their own CloudFront distribution or via a future presign endpoint.

**Independent Test**: Upload and process a file, request presigned URL via API, verify URL is accessible for the TTL duration and expires after.

**Acceptance Scenarios**:

1. **Given** a completed file, **When** I call `GET /v1/files/:id/url?ttl=3600`, **Then** I receive a presigned S3 URL valid for 1 hour
2. **Given** a presigned URL that has expired, **When** I access it, **Then** I receive 403 from S3

---

### Edge Cases

- What happens when a 10GB video is uploaded? Stream-first architecture handles it, but processing time may exceed 30 minutes — webhook timeout must be configurable on client side
- What happens when S3 is unreachable during upload? Return 502 Bad Gateway with retry-after header
- What happens when FFmpeg crashes mid-processing? BullMQ retries up to 3 times with exponential backoff; after 3 failures, file status becomes `failed` with error message
- What happens when the same file is uploaded twice? Each upload gets a unique ID; no deduplication. Dedup is the client's responsibility
- What happens when a tenant is deactivated mid-upload? In-flight uploads complete, but new requests return 403
- What happens when Redis crashes? API can still accept uploads to S3 (graceful degradation), but processing queue stalls until Redis recovers. Health check reports degraded
- What if callback_url is unreachable? Retry webhook 3 times with exponential backoff (1s, 10s, 60s). After 3 failures, log and move on. Client can poll status endpoint as fallback

## Requirements

### Functional Requirements

- **FR-001**: System MUST authenticate all requests via API Key in `Authorization: Bearer mh_*` header
- **FR-002**: System MUST stream file uploads directly to S3 without buffering entire file in memory
- **FR-003**: System MUST detect media type (video, image, audio, generic) from MIME type and apply appropriate processing pipeline
- **FR-004**: System MUST generate HLS adaptive bitrate streams for video files (360p, 720p, 1080p, 4K based on source resolution)
- **FR-005**: System MUST convert images to WebP format and generate thumbnails at 320px and 720px widths
- **FR-006**: System MUST normalize audio to MP3 192kbps
- **FR-007**: System MUST store generic files without processing and provide direct S3 URL
- **FR-008**: System MUST send webhook POST to `callback_url` when all files in an upload are processed (or failed)
- **FR-009**: System MUST support batch uploads with parallel processing of individual files
- **FR-010**: System MUST enforce tenant isolation at every layer (API, DB queries, S3 paths)
- **FR-011**: System MUST support 2 active API keys per tenant for zero-downtime rotation
- **FR-012**: System MUST store API keys as SHA-256 hashes; raw key shown only at creation
- **FR-013**: System MUST provide admin endpoints for tenant CRUD and API key management
- **FR-014**: System MUST track file processing status (pending, processing, completed, failed)
- **FR-015**: System MUST retry failed processing jobs up to 3 times with exponential backoff

### Key Entities

- **Tenant**: Organization/platform that uses Media Hub. Has slug, name, scopes, active flag. Each tenant gets isolated S3 prefix and API keys
- **API Key**: Authentication credential for a tenant. Stored as SHA-256 hash. Has scopes, expiration, revocation timestamp. Max 2 active per tenant
- **Upload**: A batch session. Contains 1+ files, optional callback URL/secret, external reference for client correlation, metadata JSONB
- **File**: Individual media item within an upload. Tracks original name, MIME type, size, media type classification, S3 keys (raw + processed), processing status, processed URLs JSONB, error message

## Success Criteria

### Measurable Outcomes

- **SC-001**: Single file upload (< 100MB) completes S3 storage in under 5 seconds on standard connection
- **SC-002**: Video processing (1080p, 2 minutes) generates all HLS variants in under 3 minutes
- **SC-003**: Image processing (10MP JPEG) generates WebP + thumbnails in under 2 seconds
- **SC-004**: API responds to authenticated requests in under 50ms (p95) for non-upload endpoints
- **SC-005**: System handles 50 concurrent uploads without degradation
- **SC-006**: Zero cross-tenant data leaks in penetration testing
- **SC-007**: Worker container recovers automatically after crash, reprocessing any interrupted jobs
- **SC-008**: Webhook delivery succeeds on first attempt for 99% of callbacks (when endpoint is healthy)
