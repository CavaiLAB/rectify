import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  attachmentStoreFromEnv,
  AttachmentCollision,
  AttachmentNotFound,
  AttachmentStorageError,
  MAX_STORED_IMAGE_BYTES,
} from "../server/attachment-storage.ts";

test("存储配置失败关闭，不退回本地，也不在错误中输出凭据", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rectify-storage-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(attachmentStoreFromEnv(directory, {}).provider, "local");
  for (const env of [
    { ATTACHMENT_STORAGE: "unknown" },
    { ATTACHMENT_STORAGE: "oss" },
    {
      ATTACHMENT_STORAGE: "oss",
      OSS_ACCESS_KEY_ID_FILE: join(directory, "missing"),
    },
  ])
    assert.throws(
      () => attachmentStoreFromEnv(directory, env),
      AttachmentStorageError,
    );
  const keyFile = join(directory, "dummy-key");
  writeFileSync(keyFile, "test-credential-only", { mode: 0o600 });
  const store = attachmentStoreFromEnv(directory, {
    ATTACHMENT_STORAGE: "oss",
    OSS_BUCKET: "test-private-bucket",
    OSS_REGION: "oss-cn-hangzhou",
    OSS_ACCESS_KEY_ID_FILE: keyFile,
    OSS_ACCESS_KEY_SECRET_FILE: keyFile,
  });
  assert.equal(store.provider, "oss");
  assert.throws(
    () => store.reference("../../other-file"),
    AttachmentStorageError,
  );
});

test("本地附件拒绝路径穿越、覆盖，删除只针对指定UUID", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rectify-storage-local-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = attachmentStoreFromEnv(directory, {});
  const ref = store.reference(randomUUID());
  const bytes = Buffer.from("synthetic-test-only");
  await store.put(ref, bytes);
  await assert.rejects(store.put(ref, bytes), AttachmentCollision);
  assert.deepEqual(await store.get(ref), bytes);
  await assert.rejects(
    store.get({ ...ref, key: "../secret.webp" }),
    AttachmentStorageError,
  );
  await store.delete(ref);
  await store.delete(ref);
  await assert.rejects(store.get(ref), AttachmentNotFound);
});

test("OSS驱动拒绝跨桶、跨前缀和过大的对象，不发网络请求", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rectify-storage-oss-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = attachmentStoreFromEnv(directory, {
    ATTACHMENT_STORAGE: "oss",
    OSS_BUCKET: "test-private-bucket",
    OSS_REGION: "oss-cn-hangzhou",
    OSS_ACCESS_KEY_ID: "test-id-only",
    OSS_ACCESS_KEY_SECRET: "test-secret-only",
  });
  const ref = store.reference(randomUUID());
  await assert.rejects(
    store.get({ ...ref, bucket: "another-bucket" }),
    AttachmentStorageError,
  );
  await assert.rejects(
    store.delete({ ...ref, key: "outside/test.webp" }),
    AttachmentStorageError,
  );
  await assert.rejects(
    store.put(ref, Buffer.alloc(MAX_STORED_IMAGE_BYTES + 1)),
    AttachmentStorageError,
  );
});
