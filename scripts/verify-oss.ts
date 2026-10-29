/** 显式运行的云存储冒烟验证：独立临时数据库，不访问生产业务库。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.ts";
import { createUser } from "../server/db.ts";
import {
  attachmentStoreFromEnv,
  AttachmentCollision,
  AttachmentNotFound,
  type AttachmentStore,
  type ObjectRef,
} from "../server/attachment-storage.ts";

if (
  process.env.RECTIFY_OSS_VERIFY !== "1" ||
  process.env.ATTACHMENT_STORAGE !== "oss"
)
  throw new Error(
    "仅在明确设置 RECTIFY_OSS_VERIFY=1 与 ATTACHMENT_STORAGE=oss 后运行",
  );

const directory = mkdtempSync(join(tmpdir(), "rectify-oss-verify-"));
const target = attachmentStoreFromEnv(directory);
const allocated = new Map<string, ObjectRef>();
const store: AttachmentStore = {
  provider: "oss",
  reference: (id) => target.reference(id),
  async put(ref, bytes) {
    allocated.set(ref.key, ref);
    try {
      await target.put(ref, bytes);
    } catch (error) {
      if (error instanceof AttachmentCollision) allocated.delete(ref.key);
      throw error;
    }
  },
  get: (ref) => target.get(ref),
  delete: (ref) => target.delete(ref),
};
const { app, db, close } = createApp({
  dataDir: directory,
  attachmentStore: store,
  secureCookies: false,
});
const server = app.listen(0, "127.0.0.1");
let phase = "startup";
try {
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const password = randomUUID();
  await createUser(db, "oss-smoke", "存储验证虚构账号", password, "admin");
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rectify-Request": "1" },
    body: JSON.stringify({ username: "oss-smoke", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  async function request(path: string, method = "GET", body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        "X-Rectify-Request": "1",
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      signal: AbortSignal.timeout(30000),
    });
  }
  const project = await (
    await request("/projects", "POST", {
      name: "OSS隔离验证",
      features: ["合成截图"],
    })
  ).json();
  const [feature] = await (
    await request(`/projects/${project.id}/features`)
  ).json();
  const png = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#176958" },
  })
    .png()
    .toBuffer();
  function form() {
    const body = new FormData();
    body.append(
      "data",
      JSON.stringify({
        feature_id: feature.id,
        description: "合成截图存储验证",
        type: "问题缺陷",
      }),
    );
    body.append(
      "images",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "synthetic.png",
    );
    return body;
  }
  phase = "internal-upload";
  const internal = await request(
    `/projects/${project.id}/issues`,
    "POST",
    form(),
  );
  assert.equal(internal.status, 201);
  const first = await internal.json();
  phase = "external-upload";
  const integration = await (
    await request(`/projects/${project.id}/integrations`, "POST", {
      name: "隔离接入",
    })
  ).json();
  const external = await fetch(`${base}/external/v1/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.api_key}`,
      "Idempotency-Key": randomUUID(),
    },
    body: form(),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(external.status, 201);
  const receipt = await external.json();
  const second = await (await request(`/issues/${receipt.id}`)).json();
  assert.equal(readdirSync(join(directory, "uploads")).length, 0);
  phase = "authenticated-read-and-delete";
  for (const detail of [first, second]) {
    const id = detail.attachments[0].id;
    assert.equal((await fetch(`${base}/attachments/${id}`)).status, 401);
    const response = await request(`/attachments/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.equal(
      (await sharp(Buffer.from(await response.arrayBuffer())).metadata())
        .format,
      "webp",
    );
    const removed = await request(`/attachments/${id}`, "DELETE");
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).cleanupPending, false);
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM attachment_cleanup").get()!.n,
    0,
  );
  for (const ref of allocated.values())
    await assert.rejects(target.get(ref), AttachmentNotFound);
  console.log(
    JSON.stringify({
      ok: true,
      isolatedDatabase: true,
      internalAndExternalUpload: true,
      authenticatedRead: true,
      localImageFiles: 0,
      syntheticObjectsDeleted: allocated.size,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      phase,
      message: "隔离云存储验证失败，未打印请求或凭据",
    }),
  );
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await close();
  let cleanupFailed = false;
  for (const ref of allocated.values()) {
    try {
      await target.delete(ref);
    } catch {
      cleanupFailed = true;
      console.error(JSON.stringify({ syntheticObjectCleanupFailed: ref.key }));
    }
  }
  if (cleanupFailed) process.exitCode = 1;
  rmSync(directory, { recursive: true, force: true });
}
