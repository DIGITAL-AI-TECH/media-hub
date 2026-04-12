import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_BUCKET: z.string(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_PREFIX: z.string().default('media-hub'),
  CDN_BASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  ALLOWED_ORIGINS: z.string().default('*'),
  // Note: ALLOWED_ORIGINS='*' in production logs a warning — set explicit origins for production
  WORKER_CONCURRENCY: z.coerce.number().default(2),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const data = parsed.data;
  if (data.ALLOWED_ORIGINS === '*' && data.NODE_ENV === 'production') {
    console.warn('[WARN] ALLOWED_ORIGINS=* in production — set explicit origins via env var');
  }
  return data;
}

export const env = loadEnv();
