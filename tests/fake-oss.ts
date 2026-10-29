import {
  AttachmentNotFound,
  AttachmentStorageError,
  type AttachmentStore,
  type ObjectRef,
} from "../server/attachment-storage.ts";
export class FakeOssStore implements AttachmentStore {
  readonly provider = "oss" as const;
  objects = new Map<string, Buffer>();
  putCalls = 0;
  getCalls = 0;
  deleteCalls = 0;
  failPutAt = 0;
  failDelete = false;
  failGet = false;
  beforePut?: () => Promise<void>;
  reference(id: string): ObjectRef {
    return {
      provider: "oss",
      bucket: "test-private-bucket",
      key: `attachments/${id}.webp`,
    };
  }
  async put(ref: ObjectRef, bytes: Buffer) {
    this.putCalls++;
    if (this.beforePut) await this.beforePut();
    if (this.failPutAt === this.putCalls)
      throw new AttachmentStorageError("InjectedUploadFailure");
    this.objects.set(ref.key, Buffer.from(bytes));
  }
  async get(ref: ObjectRef) {
    this.getCalls++;
    if (this.failGet) throw new AttachmentStorageError("InjectedReadFailure");
    const value = this.objects.get(ref.key);
    if (!value) throw new AttachmentNotFound();
    return Buffer.from(value);
  }
  async delete(ref: ObjectRef) {
    this.deleteCalls++;
    if (this.failDelete)
      throw new AttachmentStorageError("InjectedDeleteFailure");
    this.objects.delete(ref.key);
  }
}
