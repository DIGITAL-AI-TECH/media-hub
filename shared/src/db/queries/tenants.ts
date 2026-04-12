import { Pool } from 'pg';
import crypto from 'crypto';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  scopes: string[];
  is_active: boolean;
  created_at: Date;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  key_hash: string;
  key_prefix: string;
  label: string | null;
  scopes: string[] | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

export interface ApiKeyWithTenant extends ApiKey {
  tenant_slug: string;
  tenant_scopes: string[];
  tenant_is_active: boolean;
}

export async function findTenantByApiKey(pool: Pool, apiKey: string): Promise<ApiKeyWithTenant | null> {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const result = await pool.query<ApiKeyWithTenant>(
    `SELECT ak.*, t.slug as tenant_slug, t.scopes as tenant_scopes, t.is_active as tenant_is_active
     FROM api_keys ak
     JOIN tenants t ON t.id = ak.tenant_id
     WHERE ak.key_hash = $1
       AND ak.revoked_at IS NULL
       AND t.is_active = TRUE
       AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
    [keyHash]
  );
  return result.rows[0] || null;
}

export async function updateApiKeyLastUsed(pool: Pool, keyId: string): Promise<void> {
  await pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [keyId]);
}

export async function createTenant(pool: Pool, slug: string, name: string, scopes?: string[]): Promise<Tenant> {
  const result = await pool.query<Tenant>(
    `INSERT INTO tenants (slug, name, scopes) VALUES ($1, $2, $3) RETURNING *`,
    [slug, name, scopes || ['media:upload', 'media:read']]
  );
  return result.rows[0];
}

export function generateApiKey(tenantSlug: string): { key: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `mh_${tenantSlug}_${random}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = `mh_${tenantSlug}_`;
  return { key, hash, prefix };
}

export async function createApiKey(
  pool: Pool,
  tenantId: string,
  keyHash: string,
  keyPrefix: string,
  label?: string,
  scopes?: string[]
): Promise<ApiKey> {
  const result = await pool.query<ApiKey>(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, label, scopes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, keyHash, keyPrefix, label || null, scopes || null]
  );
  return result.rows[0];
}
