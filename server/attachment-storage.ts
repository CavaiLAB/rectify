import { mkdirSync, readFileSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import OSS from "ali-oss";

export interface ObjectRef {
  provider: "local" | "oss";
  bucket: string;
  key: string;
}
export interface AttachmentStore {
  readonly provider: ObjectRef["provider"];
  reference(id: string): ObjectRef;
  put(ref: ObjectRef, data: Buffer): Promise<void>;
  get(ref: ObjectRef): Promise<Buffer>;
  delete(ref: ObjectRef): Promise<void>;
}
export class AttachmentStorageError extends Error {
  constructor(public readonly code = "StorageUnavailable") {
    super("附件存储暂不可用，请稍后重试");
    this.name = "AttachmentStorageError";
  }
}
export class AttachmentNotFound extends AttachmentStorageError {
  constructor() {
    super("ObjectNotFound");
  }
}
export class AttachmentCollision extends AttachmentStorageError {
  constructor() {
    super("ObjectAlreadyExists");
  }
}
export const MAX_STORED_IMAGE_BYTES = 16 * 1024 * 1024;
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(id: string) {
  if (!idPattern.test(id)) throw new AttachmentStorageError("InvalidObjectId");
}
function safeCode(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(code)
    ? code
    : "StorageUnavailable";
}

export class LocalAttachmentStore implements AttachmentStore {
  readonly provider = "local" as const;
  readonly directory: string;
  constructor(dataDir: string) {
    this.directory = resolve(dataDir, "uploads");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  reference(id: string): ObjectRef {
    validId(id);
    return { provider: "local", bucket: "", key: `${id}.webp` };
  }
  private file(ref: ObjectRef) {
    if (
      ref.provider !== "local" ||
      ref.bucket !== "" ||
      !ref.key.endsWith(".webp")
    )
      throw new AttachmentStorageError("InvalidLocalObject");
    validId(ref.key.slice(0, -5));
    return join(this.directory, ref.key);
  }
  async put(ref: ObjectRef, data: Buffer) {
    try {
      await writeFile(this.file(ref), data, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (safeCode(e) === "EEXIST") throw new AttachmentCollision();
      throw new AttachmentStorageError(safeCode(e));
    }
  }
  async get(ref: ObjectRef) {
    try {
      return await readFile(this.file(ref));
    } catch (e) {
      if (safeCode(e) === "ENOENT") throw new AttachmentNotFound();
      throw new AttachmentStorageError(safeCode(e));
    }
  }
  async delete(ref: ObjectRef) {
    try {
      await unlink(this.file(ref));
    } catch (e) {
      if (safeCode(e) !== "ENOENT")
        throw new AttachmentStorageError(safeCode(e));
    }
  }
}

export interface OssConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
}
export class OssAttachmentStore implements AttachmentStore {
  readonly provider = "oss" as const;
  private readonly client: OSS;
  constructor(private readonly config: OssConfig) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^oss-[a-z0-9-]+$/.test(config.region) ||
      !config.accessKeyId ||
      !config.accessKeySecret
    )
      throw new AttachmentStorageError("InvalidOssConfiguration");
    this.client = new OSS({
      ...config,
      secure: true,
      authorizationV4: true,
      timeout: 20000,
    });
  }
  reference(id: string): ObjectRef {
    validId(id);
    return {
      provider: "oss",
      bucket: this.config.bucket,
      key: `attachments/${id}.webp`,
    };
  }
  private key(ref: ObjectRef) {
    if (
      ref.provider !== "oss" ||
      ref.bucket !== this.config.bucket ||
      !ref.key.startsWith("attachments/") ||
      !ref.key.endsWith(".webp")
    )
      throw new AttachmentStorageError("ObjectStoreMismatch");
    validId(ref.key.slice("attachments/".length, -5));
    return ref.key;
  }
  async put(ref: ObjectRef, data: Buffer) {
    if (data.length > MAX_STORED_IMAGE_BYTES)
      throw new AttachmentStorageError("ObjectTooLarge");
    try {
      await this.client.put(this.key(ref), data, {
        mime: "image/webp",
        headers: {
          "x-oss-forbid-overwrite": "true",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      const code = safeCode(e);
      if (["FileAlreadyExists", "ObjectAlreadyExists"].includes(code))
        throw new AttachmentCollision();
      throw new AttachmentStorageError(code);
    }
  }
  async get(ref: ObjectRef) {
    try {
      // 限制云端返回的最大字节数，避免被异常大对象耗尽内存。
      const result = await this.client.get(this.key(ref), {
        headers: { Range: `bytes=0-${MAX_STORED_IMAGE_BYTES}` },
      });
      const bytes = Buffer.from(result.content);
      if (bytes.length > MAX_STORED_IMAGE_BYTES)
        throw new AttachmentStorageError("ObjectTooLarge");
      return bytes;
    } catch (e) {
      if (safeCode(e) === "NoSuchKey") throw new AttachmentNotFound();
      throw new AttachmentStorageError(safeCode(e));
    }
  }
  async delete(ref: ObjectRef) {
    try {
      await this.client.delete(this.key(ref), { timeout: 5000 });
    } catch (e) {
      if (safeCode(e) !== "NoSuchKey")
        throw new AttachmentStorageError(safeCode(e));
    }
  }
}

export function attachmentStoreFromEnv(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): AttachmentStore {
  const provider = env.ATTACHMENT_STORAGE ?? "local";
  if (provider === "local") return new LocalAttachmentStore(dataDir);
  if (provider !== "oss")
    throw new AttachmentStorageError("UnknownStorageProvider");
  function credential(name: string) {
    try {
      return env[`${name}_FILE`]
        ? readFileSync(env[`${name}_FILE`]!, "utf8").trim()
        : (env[name] ?? "").trim();
    } catch {
      throw new AttachmentStorageError("OssCredentialFileUnavailable");
    }
  }
  return new OssAttachmentStore({
    bucket: env.OSS_BUCKET ?? "",
    region: env.OSS_REGION ?? "",
    accessKeyId: credential("OSS_ACCESS_KEY_ID"),
    accessKeySecret: credential("OSS_ACCESS_KEY_SECRET"),
    stsToken: credential("OSS_SECURITY_TOKEN") || undefined,
  });
}
