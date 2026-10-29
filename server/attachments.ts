import { createHash } from "node:crypto";
import type { DB } from "./db.ts";
import {
  AttachmentCollision,
  AttachmentStorageError,
  LocalAttachmentStore,
  type AttachmentStore,
  type ObjectRef,
} from "./attachment-storage.ts";

export interface PreparedImage {
  id: string;
  name: string;
  buffer: Buffer;
}
export interface StagedImage extends PreparedImage {
  object: ObjectRef;
  sha256: string;
}
interface CleanupRow {
  id: string;
  provider: ObjectRef["provider"];
  bucket: string;
  object_key: string;
  attempts: number;
}
interface ObjectRow extends CleanupRow {
  sha256: string;
}
const hash = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const STAGING_LIFETIME = 60 * 60 * 1000;

/** 网络操作在 SQLite 事务之外；暂存与清理任务持久化，进程中断后仍可回收未引用对象。 */
export class AttachmentManager {
  readonly provider: AttachmentStore["provider"];
  private readonly local: LocalAttachmentStore;
  private readonly target: AttachmentStore;
  private timer?: ReturnType<typeof setInterval>;
  private collecting?: Promise<void>;
  constructor(
    private readonly db: DB,
    dataDir: string,
    target?: AttachmentStore,
  ) {
    this.local = new LocalAttachmentStore(dataDir);
    this.target = target ?? this.local;
    this.provider = this.target.provider;
  }
  start() {
    this.timer = setInterval(() => {
      void this.collect().catch(() => console.error("附件清理任务暂不可用"));
    }, 60000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.collecting;
  }
  private store(ref: ObjectRef) {
    return ref.provider === "local"
      ? this.local
      : this.target.provider === "oss"
        ? this.target
        : (() => {
            throw new AttachmentStorageError("OssStorageNotConfigured");
          })();
  }
  private ref(row: CleanupRow): ObjectRef {
    return { provider: row.provider, bucket: row.bucket, key: row.object_key };
  }
  async stage(images: PreparedImage[]): Promise<StagedImage[]> {
    const staged = images.map((image) => ({
      ...image,
      object: this.target.reference(image.id),
      sha256: hash(image.buffer),
    }));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const image of staged) {
        if (
          this.db.prepare("SELECT id FROM attachments WHERE id=?").get(image.id)
        )
          throw new AttachmentCollision();
        this.db
          .prepare(
            "INSERT INTO attachment_cleanup (id,provider,bucket,object_key,not_before,attempts) VALUES(?,?,?,?,?,0)",
          )
          .run(
            image.id,
            image.object.provider,
            image.object.bucket,
            image.object.key,
            Date.now() + STAGING_LIFETIME,
          );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    const uploaded: StagedImage[] = [];
    for (let index = 0; index < staged.length; index++) {
      const image = staged[index];
      try {
        await this.target.put(image.object, image.buffer);
        uploaded.push(image);
      } catch (e) {
        // 未尝试上传的对象无需清理；碰撞对象不属于本次上传，绝不删除。
        for (const unstarted of staged.slice(index + 1))
          this.db
            .prepare("DELETE FROM attachment_cleanup WHERE id=?")
            .run(unstarted.id);
        if (e instanceof AttachmentCollision)
          this.db
            .prepare("DELETE FROM attachment_cleanup WHERE id=?")
            .run(image.id);
        else
          this.db
            .prepare("UPDATE attachment_cleanup SET not_before=? WHERE id=?")
            .run(Date.now() + 60000, image.id);
        await this.discard(uploaded);
        throw e;
      }
    }
    return staged;
  }
  /** 只能在调用方的同步数据库事务中执行。 */
  commit(issueId: string, images: StagedImage[]) {
    for (const image of images) {
      const pending = this.db
        .prepare("SELECT not_before FROM attachment_cleanup WHERE id=?")
        .get(image.id);
      if (!pending || Number(pending.not_before) <= Date.now())
        throw new AttachmentStorageError("UploadReservationExpired");
      this.db
        .prepare(
          "INSERT INTO attachments (id,issue_id,name,size,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          image.id,
          issueId,
          image.name,
          image.buffer.length,
          new Date().toISOString(),
        );
      this.db
        .prepare(
          "INSERT INTO attachment_objects (attachment_id,provider,bucket,object_key,sha256) VALUES(?,?,?,?,?)",
        )
        .run(
          image.id,
          image.object.provider,
          image.object.bucket,
          image.object.key,
          image.sha256,
        );
      this.db
        .prepare("DELETE FROM attachment_cleanup WHERE id=?")
        .run(image.id);
    }
  }
  async discard(images: StagedImage[]) {
    for (const image of images) {
      const row = this.db
        .prepare("SELECT * FROM attachment_cleanup WHERE id=?")
        .get(image.id) as unknown as CleanupRow | undefined;
      if (row) await this.clean(row);
    }
  }
  /** 在删除附件元数据的同一个事务中登记清理任务。 */
  queueDelete(id: string) {
    const stored = this.db
      .prepare(
        "SELECT attachment_id id, provider,bucket,object_key FROM attachment_objects WHERE attachment_id=?",
      )
      .get(id) as unknown as CleanupRow | undefined;
    const ref = stored ? this.ref(stored) : this.local.reference(id);
    this.db
      .prepare(
        "INSERT INTO attachment_cleanup (id,provider,bucket,object_key,not_before,attempts) VALUES(?,?,?,?,?,0)",
      )
      .run(id, ref.provider, ref.bucket, ref.key, Date.now());
  }
  async read(id: string, expectedSize: number) {
    const row = this.db
      .prepare(
        "SELECT attachment_id id,provider,bucket,object_key,sha256 FROM attachment_objects WHERE attachment_id=?",
      )
      .get(id) as unknown as ObjectRow | undefined;
    const ref = row ? this.ref(row) : this.local.reference(id);
    const bytes = await this.store(ref).get(ref);
    if (
      bytes.length !== expectedSize ||
      (row?.sha256 && hash(bytes) !== row.sha256)
    )
      throw new AttachmentStorageError("AttachmentIntegrityMismatch");
    return bytes;
  }
  async cleanOne(id: string) {
    const row = this.db
      .prepare("SELECT * FROM attachment_cleanup WHERE id=?")
      .get(id) as unknown as CleanupRow | undefined;
    if (row) await this.clean(row);
  }
  collect(): Promise<void> {
    if (this.collecting) return this.collecting;
    const operation = async () => {
      const rows = this.db
        .prepare(
          "SELECT * FROM attachment_cleanup WHERE not_before<=? ORDER BY not_before LIMIT 3",
        )
        .all(Date.now()) as unknown as CleanupRow[];
      for (const row of rows) await this.clean(row);
    };
    this.collecting = operation().finally(() => {
      this.collecting = undefined;
    });
    return this.collecting;
  }
  private async clean(row: CleanupRow) {
    if (this.db.prepare("SELECT id FROM attachments WHERE id=?").get(row.id)) {
      this.db.prepare("DELETE FROM attachment_cleanup WHERE id=?").run(row.id);
      return;
    }
    try {
      await this.store(this.ref(row)).delete(this.ref(row));
      this.db.prepare("DELETE FROM attachment_cleanup WHERE id=?").run(row.id);
    } catch (e) {
      const code =
        e instanceof AttachmentStorageError ? e.code : "StorageUnavailable";
      this.db
        .prepare(
          "UPDATE attachment_cleanup SET attempts=attempts+1,not_before=?,last_error=? WHERE id=?",
        )
        .run(
          Date.now() +
            Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6)),
          code,
          row.id,
        );
      console.warn("附件清理待重试", code);
    }
  }
}
