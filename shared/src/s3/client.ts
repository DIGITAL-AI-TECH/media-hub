import { S3Client, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { env } from '../config/env.js';

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export function buildS3Key(tenantSlug: string, ...parts: string[]): string {
  return [env.S3_PREFIX, tenantSlug, ...parts].filter(Boolean).join('/');
}

export function buildCdnUrl(s3Key: string): string {
  return `${env.CDN_BASE_URL}/${s3Key}`;
}

export async function streamToS3(
  stream: Readable,
  s3Key: string,
  contentType: string
): Promise<void> {
  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket: env.S3_BUCKET,
      Key: s3Key,
      Body: stream,
      ContentType: contentType,
    },
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
}

export async function downloadFromS3(s3Key: string): Promise<Readable> {
  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: s3Key,
  }));
  return response.Body as Readable;
}

export async function uploadFileToS3(localPath: string, s3Key: string, contentType: string): Promise<void> {
  const fs = await import('fs');
  const stream = fs.createReadStream(localPath);
  await streamToS3(stream, s3Key, contentType);
}

export async function deleteFromS3(s3Key: string): Promise<void> {
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: s3Key,
  }));
}
