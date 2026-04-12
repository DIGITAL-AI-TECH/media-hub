import { readFileSync } from 'fs';
import path from 'path';
import { getPool, closePool } from '@media-hub/shared';

async function migrate() {
  const pool = getPool();
  const sql = readFileSync(
    path.join(process.cwd(), 'shared/src/db/migrations/001_initial.sql'),
    'utf-8'
  );
  console.log('Running migration...');
  await pool.query(sql);
  console.log('Migration complete.');
  await closePool();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
