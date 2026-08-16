import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    });
    this.publicClient = new S3Client({
      ...clientOptions,
      endpoint: config.getOrThrow<string>('S3_PUBLIC_ENDPOINT'),
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

  headObject(key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getObject(key: string) {
    return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }
}
