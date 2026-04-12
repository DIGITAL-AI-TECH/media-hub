import { getPool, createTenant, generateApiKey, createApiKey, closePool } from '@media-hub/shared';

async function seed() {
  const slug = process.argv[2] || 'digital-ai';
  const name = process.argv[3] || 'Digital AI';
  const pool = getPool();

  console.log(`Creating tenant: ${slug}`);
  const tenant = await createTenant(pool, slug, name, ['media:upload', 'media:read', 'media:delete']);

  const { key, hash, prefix } = generateApiKey(tenant.slug);
  await createApiKey(pool, tenant.id, hash, prefix, 'default');

  console.log(`\nTenant created!`);
  console.log(`   Tenant ID: ${tenant.id}`);
  console.log(`   Slug: ${tenant.slug}`);
  console.log(`\nAPI Key (save this — shown only once):`);
  console.log(`   ${key}`);

  await closePool();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
