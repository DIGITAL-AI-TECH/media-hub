import { z } from 'zod';

export const MediaTypeSchema = z.enum(['image', 'video', 'audio', 'generic']);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const FileStatusSchema = z.enum(['pending', 'queued', 'processing', 'done', 'failed']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const UploadStatusSchema = z.enum(['pending', 'processing', 'done', 'partial', 'failed']);
export type UploadStatus = z.infer<typeof UploadStatusSchema>;

export const CreateUploadSchema = z.object({
  external_ref: z.string().max(256).optional(),
  callback_url: z.string().url().optional(),
  callback_secret: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateUploadInput = z.infer<typeof CreateUploadSchema>;

export const ProcessingJobSchema = z.object({
  fileId: z.string().uuid(),
  uploadId: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  mediaType: MediaTypeSchema,
  s3KeyRaw: z.string(),
  mimeType: z.string(),
  originalName: z.string(),
});
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

export interface ProcessedUrls {
  // Video
  hls_master?: string;
  hls_360p?: string;
  hls_720p?: string;
  hls_1080p?: string;
  hls_4k?: string;
  thumb?: string;
  // Image
  original?: string;
  thumb_320?: string;
  thumb_720?: string;
  // Audio
  mp3?: string;
  // Generic
  url?: string;
}

export interface TenantContext {
  id: string;
  slug: string;
  scopes: string[];
}
