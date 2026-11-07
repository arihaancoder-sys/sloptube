// R2 through its S3 API. Only the API routes import this file (they are
// server only), and the tests load it directly with a mocked client.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { UploadStorage } from "./handlers.ts";

export type R2ClientConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** An S3 client pointed at the account's R2 endpoint. */
export function createR2Client(config: R2ClientConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // https://<account>.r2.cloudflarestorage.com/<bucket>/<key>, one host for every bucket.
    forcePathStyle: true,
    // Newer SDKs add checksum headers to every request by default. Presigned
    // part URLs must not expect them, because the browser does not send them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** UploadStorage on top of an S3 client and one bucket. */
export function createR2Storage(client: S3Client, bucket: string): UploadStorage {
  return {
    async createMultipart(key, mime) {
      const out = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: mime }));
      if (!out.UploadId) throw new Error("R2 did not return an upload id");
      return out.UploadId;
    },

    presignPart(key, uploadId, partNumber, expiresIn) {
      return getSignedUrl(
        client,
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn },
      );
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },

    async objectSize(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return typeof out.ContentLength === "number" ? out.ContentLength : null;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
        throw err;
      }
    },
  };
}
