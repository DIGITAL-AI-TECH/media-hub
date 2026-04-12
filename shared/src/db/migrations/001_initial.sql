CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(64) NOT NULL UNIQUE,
  name          VARCHAR(256) NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['media:upload', 'media:read'],
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash      CHAR(64) NOT NULL UNIQUE,
  key_prefix    VARCHAR(32) NOT NULL,
  label         VARCHAR(128),
  scopes        TEXT[],
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  external_ref    VARCHAR(256),
  status          VARCHAR(32) NOT NULL DEFAULT 'pending',
  files_count     INTEGER NOT NULL DEFAULT 0,
  callback_url    TEXT,
  callback_secret VARCHAR(128),
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_tenant ON uploads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status) WHERE status NOT IN ('done', 'failed');

CREATE TABLE IF NOT EXISTS files (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id             UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  original_name         VARCHAR(512) NOT NULL,
  mime_type             VARCHAR(128) NOT NULL,
  size_bytes            BIGINT,
  media_type            VARCHAR(16) NOT NULL,
  s3_key_raw            TEXT NOT NULL,
  s3_key_processed      TEXT,
  status                VARCHAR(32) NOT NULL DEFAULT 'pending',
  processed_urls        JSONB,
  error_message         TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_done_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_upload ON files(upload_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status) WHERE status NOT IN ('done', 'failed');
