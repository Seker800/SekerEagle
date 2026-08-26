import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeHttpHandler, type NodeHttpHandlerOptions } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import {
  executeObjectReadWithRetry,
  isRetryableObjectReadError,
} from './object-storage-read-retry';

@Injectable()
export class ObjectStorageService implements OnModuleDestroy {
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    const clientOptions = {
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    };
    this.client = new S3Client({
      ...clientOptions,
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      requestHandler: createObjectStorageRequestHandler(config),
    });
    this.publicClient = new S3Client({
      ...clientOptions,
      endpoint: config.getOrThrow<string>('S3_PUBLIC_ENDPOINT'),
      requestHandler: createObjectStorageRequestHandler(config),
    });
  }

  async assertReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!response.UploadId) throw new Error('对象存储未返回 multipart upload id');
    return response.UploadId;
  }

  presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 900 },
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  async listMultipartUploadParts(
    key: string,
    uploadId: string,
  ): Promise<Array<{ partNumber: number; etag: string; size: number }>> {
    const parts: Array<{ partNumber: number; etag: string; size: number }> = [];
    let partNumberMarker: string | undefined;
    do {
      const response = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: partNumberMarker,
        }),
      );
      for (const part of response.Parts ?? []) {
        if (part.PartNumber === undefined || !part.ETag) continue;
        parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size ?? 0 });
      }
      partNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
    } while (partNumberMarker);
    return parts.sort((left, right) => left.partNumber - right.partNumber);
  }

  headObject(key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getObject(key: string, options?: { range?: string; ifNoneMatch?: string }) {
    try {
      return await executeObjectReadWithRetry(() =>
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Range: options?.range,
            IfNoneMatch: options?.ifNoneMatch,
          }),
        ),
      );
    } catch (error) {
      if (isRetryableObjectReadError(error))
        throw new ServiceUnavailableException('对象存储暂时不可用，请稍后重试。');
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }
}

export function createObjectStorageRequestHandler(config: ConfigService): NodeHttpHandler {
  return new NodeHttpHandler(objectStorageHttpHandlerOptions(config));
}

export function objectStorageHttpHandlerOptions(config: ConfigService): NodeHttpHandlerOptions {
  const maxSockets = config.getOrThrow<number>('S3_MAX_SOCKETS');
  return {
    connectionTimeout: config.getOrThrow<number>('S3_CONNECTION_TIMEOUT_MS'),
    requestTimeout: config.getOrThrow<number>('S3_REQUEST_TIMEOUT_MS'),
    throwOnRequestTimeout: true,
    socketTimeout: config.getOrThrow<number>('S3_SOCKET_TIMEOUT_MS'),
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets }),
  };
}
