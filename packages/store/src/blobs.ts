/** Binary files (EPUB, covers, database dumps): Cloudflare R2 through its S3 API, or memory for tests. */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys under `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** The one method of `S3Client` we use, so tests can pass a fake. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override the endpoint (tests, other S3-compatible stores). */
  endpoint?: string;
  client?: S3Like;
}

export class R2BlobStore implements BlobStore {
  private readonly client: S3Like;
  private readonly bucket: string;

  constructor(options: R2Options) {
    this.bucket = options.bucket;
    this.client =
      options.client ??
      new S3Client({
        region: "auto",
        endpoint: options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const out = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      return out.Body ? await out.Body.transformToByteArray() : null;
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      )) as {
        Contents?: { Key?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      for (const item of out.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }
}

/** The R2 settings from the environment, or null when they are not all set. Never logs the values. */
export function r2OptionsFromEnv(env: NodeJS.ProcessEnv = process.env): R2Options | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}
