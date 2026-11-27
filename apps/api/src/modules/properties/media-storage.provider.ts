import { Injectable } from '@nestjs/common';
import type { PropertyAssetKind } from '@prisma/client';

export const MEDIA_STORAGE_PROVIDER = 'MEDIA_STORAGE_PROVIDER';

export interface PresignedUploadRequest {
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  kind: PropertyAssetKind;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  publicUrl: string | null;
  expiresInSeconds: number;
}

export interface MediaStorageProvider {
  createPresignedUpload(input: PresignedUploadRequest): Promise<PresignedUploadResult>;
  resolvePublicUrl(storageKey: string): string | null;
}

/**
 * MVP local/mock-presigned storage provider (S3/MinIO-ready interface).
 * Stores zero binary blobs in PostgreSQL; returns signed mock presigned URLs
 * for local development and tests.
 */
@Injectable()
export class LocalDevMediaStorageProvider implements MediaStorageProvider {
  private static readonly PRESIGN_TTL_SECONDS = 900;

  async createPresignedUpload(input: PresignedUploadRequest): Promise<PresignedUploadResult> {
    const encodedKey = input.storageKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return {
      uploadUrl: `https://storage.homental.local/upload/${encodedKey}?mime=${encodeURIComponent(input.mimeType)}&size=${input.sizeBytes.toString()}&expires=${LocalDevMediaStorageProvider.PRESIGN_TTL_SECONDS}`,
      publicUrl: this.resolvePublicUrl(input.storageKey),
      expiresInSeconds: LocalDevMediaStorageProvider.PRESIGN_TTL_SECONDS,
    };
  }

  resolvePublicUrl(storageKey: string): string | null {
    const encodedKey = storageKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `https://storage.homental.local/assets/${encodedKey}`;
  }
}
