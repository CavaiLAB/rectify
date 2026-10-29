import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { createApp } from "../server/app.ts";
import { createUser, openDatabase } from "../server/db.ts";
import type { Feature, IssueDetail, Project } from "../shared/types.ts";
import { FakeOssStore } from "./fake-oss.ts";
import { AttachmentManager } from "../server/attachments.ts";

const password = "test-only-password-2026";
async function pictureForm(featureId: string, count = 1) {
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#176958" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      feature_id: featureId,
      description: "测试反馈图片",
      type: "问题缺陷",
    }),
  );
  for (let i = 0; i < count; i++)
    form.append(
      "images",
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      `image-${i}.png`,
    );
  return form;
}
async function fixture(
  t: TestContext,
  options: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "rectify-api-test-"));
  const { app, db, close } = createApp({ ...options, dataDir: dir });
  const admin = await createUser(db, "admin", "测试管理员", password, "admin");
  const member = await createUser(db, "member", "测试成员", password, "member");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rectify-Request": "1" },
    body: JSON.stringify({ username: "admin", password }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    customCookie: string | null = cookie,
  ) {
    const headers = new Headers({ "X-Rectify-Request": "1" });
    if (customCookie) headers.set("Cookie", customCookie);
    if (body && !(body instanceof FormData))
      headers.set("Content-Type", "application/json");
    return fetch(`${base}/api${path}`, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }
  async function setup() {
    const p = (await (
      await request("/projects", "POST", {
        name: "虚构测试项目",
        features: ["功能A"],
      })
    ).json()) as Project;
    const features = (await (
      await request(`/projects/${p.id}/features`)
    ).json()) as Feature[];
    return { project: p, feature: features[0] };
  }
  async function issue(projectId: string, featureId: string, overrides = {}) {
    return request(`/projects/${projectId}/issues`, "POST", {
      feature_id: featureId,
      title: "测试问题",
      description: "用于自动化测试的虚构问题",
      type: "问题缺陷",
      ...overrides,
    });
  }
  return { request, setup, issue, base, cookie, dir, db, admin, member };
}

test("生产响应允许本地图片预览、保留脚本限制与Secure Cookie，并返回构建版本", async (t) => {
  const f = await fixture(t, { production: true, revision: "test-revision" });
  const response = await f.request("/health");
  assert.deepEqual(await response.json(), {
    ok: true,
    revision: "test-revision",
    storage: "local",
  });
  const csp = response.headers.get("content-security-policy")!;
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /script-src 'self'/);
  assert(!csp.includes("script-src 'self' 'unsafe-inline'"));
  const login = await f.request(
    "/auth/login",
    "POST",
    { username: "admin", password },
    null,
  );
  assert.match(login.headers.get("set-cookie")!, /; Secure/);
  assert.match(login.headers.get("set-cookie")!, /; HttpOnly/);
});

test("登记只传描述时自动生成标题，后续修改不重写既有标题", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const response = await f.request(`/projects/${project.id}/issues`, "POST", {
    feature_id: feature.id,
    description: "您好，环样性能保存失败。重新进入后为空。",
    type: "问题缺陷",
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.title, "环样性能保存失败");
  const updated = await (
    await f.request(`/issues/${created.id}`, "PATCH", {
      ...created,
      description: "补充说明：已恢复正常。",
    })
  ).json();
  assert.equal(updated.title, created.title);
  const legacy = await (
    await f.issue(project.id, feature.id, { title: "旧客户端自定义标题" })
  ).json();
  assert.equal(legacy.title, "旧客户端自定义标题");
});

test("外部接口仅传描述也可登记，幂等重试不重复生成问题", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const integration = await (
    await f.request(`/projects/${project.id}/integrations`, "POST", {
      name: "测试系统",
    })
  ).json();
  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.api_key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "auto-title-request-01",
    },
    body: JSON.stringify({
      feature_id: feature.id,
      description:
        "操作步骤：\n1. 打开报表\n实际结果：导出失败，提示格式错误。",
    }),
  };
  const first = await fetch(`${f.base}/api/external/v1/issues`, request);
  assert.equal(first.status, 201);
  const receipt = await first.json();
  const retry = await fetch(`${f.base}/api/external/v1/issues`, request);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), receipt);
  const detail = await (await f.request(`/issues/${receipt.id}`)).json();
  assert.equal(detail.title, "导出失败，提示格式错误");
  assert.equal(
    (await (await f.request(`/projects/${project.id}/issues`)).json()).length,
    1,
  );
});

test("OSS附件不落本地，读取仍需登录且不向客户端返回存储地址", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const response = await f.request(
    `/projects/${project.id}/issues`,
    "POST",
    await pictureForm(feature.id, 2),
  );
  assert.equal(response.status, 201);
  const issue = (await response.json()) as IssueDetail;
  assert.equal(store.objects.size, 2);
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 0);
  assert.equal(issue.attachments.length, 2);
  assert(!JSON.stringify(issue).includes("test-private-bucket"));
  const url = `/attachments/${issue.attachments[0].id}`;
  assert.equal((await f.request(url, "GET", undefined, null)).status, 401);
  assert.equal(store.getCalls, 0);
  const image = await f.request(url);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("cache-control")!, /private, no-store/);
  assert.equal(image.headers.get("location"), null);
  assert.equal(
    (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,
    "webp",
  );
  const deleted = await f.request(url, "DELETE");
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).cleanupPending, false);
  assert.equal(store.objects.size, 1);
  assert.equal((await f.request(url)).status, 404);
});

test("OSS部分上传失败不产生问题或附件记录，暂存任务可重试回收", async (t) => {
  const store = new FakeOssStore();
  store.failPutAt = 2;
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const response = await f.request(
    `/projects/${project.id}/issues`,
    "POST",
    await pictureForm(feature.id, 3),
  );
  assert.equal(response.status, 503);
  assert.equal(store.objects.size, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM issues").get()!.n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM attachments").get()!.n, 0);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM attachment_cleanup").get()!.n,
    1,
  );
  f.db.prepare("UPDATE attachment_cleanup SET not_before=0").run();
  const restarted = new AttachmentManager(f.db, f.dir, store);
  await restarted.collect();
  await restarted.stop();
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM attachment_cleanup").get()!.n,
    0,
  );
});

test("OSS删除失败仍隐藏附件并持久化清理任务，重试后只删该对象", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const issue = (await (
    await f.request(
      `/projects/${project.id}/issues`,
      "POST",
      await pictureForm(feature.id, 2),
    )
  ).json()) as IssueDetail;
  store.failDelete = true;
  const response = await f.request(
    `/attachments/${issue.attachments[0].id}`,
    "DELETE",
  );
  assert.equal((await response.json()).cleanupPending, true);
  assert.equal(store.objects.size, 2);
  assert.equal(
    (await f.request(`/attachments/${issue.attachments[0].id}`)).status,
    404,
  );
  store.failDelete = false;
  f.db.prepare("UPDATE attachment_cleanup SET not_before=0").run();
  const manager = new AttachmentManager(f.db, f.dir, store);
  await manager.collect();
  await manager.stop();
  assert.equal(store.objects.size, 1);
  assert.equal(
    (await f.request(`/attachments/${issue.attachments[1].id}`)).status,
    200,
  );
});

test("上传期间项目归档会拒绝提交并清理OSS暂存对象", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  store.beforePut = async () => {
    f.db.prepare("UPDATE projects SET archived=1 WHERE id=?").run(project.id);
  };
  const result = await f.request(
    `/projects/${project.id}/issues`,
    "POST",
    await pictureForm(feature.id),
  );
  assert.equal(result.status, 409);
  assert.equal(store.objects.size, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM issues").get()!.n, 0);
});

test("外部并发幂等提交只保留一套OSS对象", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const integration = await (
    await f.request(`/projects/${project.id}/integrations`, "POST", {
      name: "模拟接入",
    })
  ).json();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  store.beforePut = async () => {
    if (++entered === 2) release();
    await barrier;
  };
  const send = async () =>
    fetch(`${f.base}/api/external/v1/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.api_key}`,
        "Idempotency-Key": "concurrent-oss-test",
      },
      body: await pictureForm(feature.id),
    });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(store.objects.size, 1);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM attachment_cleanup").get()!.n,
    0,
  );
});

test("切到OSS后仍能读取历史本地附件；清理任务不会删除已提交对象", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const issue = await (await f.issue(project.id, feature.id)).json();
  const id = randomUUID();
  const bytes = await sharp({
    create: { width: 3, height: 3, channels: 3, background: "#fff" },
  })
    .webp()
    .toBuffer();
  writeFileSync(join(f.dir, "uploads", `${id}.webp`), bytes, { mode: 0o600 });
  f.db
    .prepare(
      "INSERT INTO attachments (id,issue_id,name,size,created_at) VALUES(?,?,?,?,?)",
    )
    .run(id, issue.id, "旧图片.webp", bytes.length, new Date().toISOString());
  assert.equal((await f.request(`/attachments/${id}`)).status, 200);
  assert.equal(store.getCalls, 0);
  f.db
    .prepare(
      "INSERT INTO attachment_cleanup (id,provider,bucket,object_key,not_before) VALUES(?,?,?,?,0)",
    )
    .run(id, "local", "", `${id}.webp`);
  const manager = new AttachmentManager(f.db, f.dir, store);
  await manager.collect();
  await manager.stop();
  assert.equal((await f.request(`/attachments/${id}`)).status, 200);
});

test("OSS故障或内容校验失败不改写附件元数据", async (t) => {
  const store = new FakeOssStore();
  const f = await fixture(t, { attachmentStore: store });
  const { project, feature } = await f.setup();
  const issue = (await (
    await f.request(
      `/projects/${project.id}/issues`,
      "POST",
      await pictureForm(feature.id),
    )
  ).json()) as IssueDetail;
  const id = issue.attachments[0].id;
  store.failGet = true;
  assert.equal((await f.request(`/attachments/${id}`)).status, 503);
  store.failGet = false;
  const key = store.reference(id).key;
  store.objects.set(key, Buffer.from("tampered"));
  assert.equal((await f.request(`/attachments/${id}`)).status, 503);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM attachments WHERE id=?").get(id)!.n,
    1,
  );
});

test("所有业务接口和图片均需登录，公开接口不泄露用户", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/projects",
    "/users",
    "/attachments/unknown",
    "/issues/unknown",
  ])
    assert.equal((await f.request(path, "GET", undefined, null)).status, 401);
  const response = await f.request("/auth/session", "GET", undefined, null);
  assert.deepEqual(await response.json(), { user: null, configured: true });
  const users = await (await f.request("/users")).json();
  assert.equal("password_hash" in users[0], false);
});
test("写请求具有CSRF保护，登录失败不返回会话", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await fetch(`${f.base}/api/projects`, {
        method: "POST",
        headers: { Cookie: f.cookie, "Content-Type": "application/json" },
        body: '{"name":"bad"}',
      })
    ).status,
    403,
  );
  const bad = await f.request(
    "/auth/login",
    "POST",
    { username: "admin", password: "wrong" },
    null,
  );
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
});
test("项目、功能项和新增需求保存成功；重复功能项不重复创建", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const same = await (
    await f.request(`/projects/${project.id}/features`, "POST", {
      name: feature.name,
    })
  ).json();
  assert.equal(same.id, feature.id);
  const result = await f.issue(project.id, feature.id, {
    type: "新增功能",
  });
  assert.equal(result.status, 201);
  const issue = await result.json();
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "待处理");
  assert.equal(issue.assignee_name, null);
  const assigned = await (
    await f.request(`/issues/${issue.id}`, "PATCH", {
      ...issue,
      assignee_id: f.member.id,
    })
  ).json();
  assert.equal(assigned.assignee_name, "测试成员");
  assert.equal((await (await f.request("/projects")).json())[0].issue_count, 1);
});
test("不能将问题关联到其他项目功能项或不存在的责任人", async (t) => {
  const f = await fixture(t);
  const one = await f.setup();
  const two = await f.setup();
  assert.equal((await f.issue(one.project.id, two.feature.id)).status, 400);
  assert.equal(
    (
      await f.issue(one.project.id, one.feature.id, {
        assignee_id: "00000000-0000-4000-8000-000000000000",
      })
    ).status,
    400,
  );
});
test("整改说明、复验通过、关闭和返工状态校验", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const issue = (await (
    await f.issue(project.id, feature.id)
  ).json()) as IssueDetail;
  assert.equal(
    (
      await f.request(`/issues/${issue.id}`, "PATCH", {
        ...issue,
        status: "待复验",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(`/issues/${issue.id}`, "PATCH", {
        ...issue,
        status: "已关闭",
        resolution: "已修复",
      })
    ).status,
    400,
  );
  const ready = await (
    await f.request(`/issues/${issue.id}`, "PATCH", {
      ...issue,
      status: "待复验",
      resolution: "已修复",
    })
  ).json();
  assert(ready.completed_at);
  assert.equal(
    (
      await f.request(`/issues/${issue.id}`, "PATCH", {
        ...ready,
        verification: "不通过",
      })
    ).status,
    400,
  );
  const closed = await (
    await f.request(`/issues/${issue.id}`, "PATCH", {
      ...ready,
      status: "已关闭",
      verification: "通过",
    })
  ).json();
  assert.equal(closed.status, "已关闭");
  assert.equal(closed.activities.length, 3);
  const reopened = await (
    await f.request(`/issues/${issue.id}`, "PATCH", {
      ...closed,
      status: "处理中",
      verification: "不通过",
    })
  ).json();
  assert.equal(reopened.completed_at, null);
});
test("旧版本修改返回409，不覆盖他人的修改", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const issue = await (await f.issue(project.id, feature.id)).json();
  assert.equal(
    (
      await f.request(`/issues/${issue.id}`, "PATCH", {
        ...issue,
        title: "最新标题",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(`/issues/${issue.id}`, "PATCH", {
        ...issue,
        title: "过时标题",
      })
    ).status,
    409,
  );
  assert.equal(
    (await (await f.request(`/issues/${issue.id}`)).json()).title,
    "最新标题",
  );
});
test("图片验证、去元数据转码、登录下载与删除记录", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#176958" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      feature_id: feature.id,
      title: "图片问题",
      description: "测试上传",
      type: "问题缺陷",
    }),
  );
  form.append(
    "images",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "screen.png",
  );
  const result = await f.request(
    `/projects/${project.id}/issues`,
    "POST",
    form,
  );
  assert.equal(result.status, 201);
  const issue = (await result.json()) as IssueDetail;
  assert.equal(issue.attachments.length, 1);
  const imagePath = `/attachments/${issue.attachments[0].id}`;
  assert.equal(
    (await f.request(imagePath, "GET", undefined, null)).status,
    401,
  );
  const file = await f.request(imagePath);
  assert.match(file.headers.get("content-type")!, /image\/webp/);
  assert.equal(
    (await sharp(Buffer.from(await file.arrayBuffer())).metadata()).format,
    "webp",
  );
  assert.equal((await f.request(imagePath, "DELETE")).status, 200);
  assert.equal((await f.request(imagePath)).status, 404);
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 0);
});
test("伪图片或超数量上传不留下问题和文件", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      feature_id: feature.id,
      title: "无效上传",
      description: "不应入库",
      type: "问题缺陷",
    }),
  );
  form.append(
    "images",
    new Blob(["<script>bad</script>"], { type: "image/png" }),
    "fake.png",
  );
  assert.equal(
    (await f.request(`/projects/${project.id}/issues`, "POST", form)).status,
    400,
  );
  assert.equal(
    (await (await f.request(`/projects/${project.id}/issues`)).json()).length,
    0,
  );
  const issue = await (await f.issue(project.id, feature.id)).json();
  const many = new FormData();
  for (let i = 0; i < 7; i++)
    many.append(
      "images",
      new Blob(["fake"], { type: "image/png" }),
      `${i}.png`,
    );
  assert.equal(
    (await f.request(`/issues/${issue.id}/attachments`, "POST", many)).status,
    400,
  );
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 0);
});
test("归档项目只读，恢复后可以继续登记", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const issue = await (await f.issue(project.id, feature.id)).json();
  const update = { name: project.name, description: "", archived: true };
  assert.equal(
    (await f.request(`/projects/${project.id}`, "PATCH", update)).status,
    200,
  );
  assert.equal((await f.issue(project.id, feature.id)).status, 409);
  assert.equal(
    (await f.request(`/issues/${issue.id}`, "PATCH", issue)).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/issues/${issue.id}/comments`, "POST", {
        message: "不应允许",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/projects/${project.id}/features`, "POST", {
        name: "新功能",
      })
    ).status,
    409,
  );
  assert.equal((await f.request(`/issues/${issue.id}`)).status, 200);
  await f.request(`/projects/${project.id}`, "PATCH", {
    ...update,
    archived: false,
  });
  assert.equal((await f.issue(project.id, feature.id)).status, 201);
});
test("普通成员不能创建账号；密码变更使旧会话失效", async (t) => {
  const f = await fixture(t);
  const result = await f.request(
    "/auth/login",
    "POST",
    { username: "member", password },
    null,
  );
  const cookie = result.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await f.request(
        "/users",
        "POST",
        { username: "new", name: "测试", password },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "/auth/password",
        "POST",
        { current: password, password: "different-test-password" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/projects", "GET", undefined, cookie)).status,
    401,
  );
});
test("数据持久化可在另一个数据库连接读取，跟进记录保留", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const issue = await (await f.issue(project.id, feature.id)).json();
  await f.request(`/issues/${issue.id}/comments`, "POST", {
    message: "已安排复验",
  });
  const db = openDatabase(f.dir);
  assert.equal(
    db.prepare("SELECT title FROM issues WHERE id=?").get(issue.id)?.title,
    issue.title,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM activities WHERE issue_id=?")
      .get(issue.id)?.n,
    2,
  );
  db.close();
});
test("日期和类型非法时不能入库，功能项重命名同步展示", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  assert.equal(
    (await f.issue(project.id, feature.id, { due_date: "2026-02-30" })).status,
    400,
  );
  assert.equal(
    (await f.issue(project.id, feature.id, { type: "随意类型" })).status,
    400,
  );
  const issue = await (await f.issue(project.id, feature.id)).json();
  await f.request(`/projects/${project.id}/features/${feature.id}`, "PATCH", {
    name: "更名功能",
  });
  assert.equal(
    (await (await f.request(`/issues/${issue.id}`)).json()).feature_name,
    "更名功能",
  );
});

test("外部凭据仅能读取绑定项目功能项和提交，不能访问内部数据或其他项目", async (t) => {
  const f = await fixture(t);
  const one = await f.setup();
  const two = await f.setup();
  const key = await (
    await f.request(`/projects/${one.project.id}/integrations`, "POST", {
      name: "测试系统",
    })
  ).json();
  const headers = {
    Authorization: `Bearer ${key.api_key}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "request-test-0001",
  };
  const external = (path: string, body?: unknown) =>
    fetch(`${f.base}/api/external/v1${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  const features = await (await external("/features")).json();
  assert.equal(features.features.length, 1);
  assert.equal(features.features[0].id, one.feature.id);
  assert.equal(
    (await fetch(`${f.base}/api/projects`, { headers })).status,
    401,
  );
  assert.equal((await external("/issues/internal-id")).status, 404);
  assert.equal(
    (
      await external("/issues", {
        feature_id: two.feature.id,
        title: "反馈",
        description: "不能跨项目",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await external("/issues", {
        feature_id: one.feature.id,
        title: "反馈",
        description: "不能指派",
        assignee_id: f.admin.id,
      })
    ).status,
    400,
  );
  const result = await external("/issues", {
    feature_id: one.feature.id,
    title: "反馈",
    description: "客户只登记问题",
    reporter_name: "虚构客户",
    source_path: "/lab/report",
  });
  assert.equal(result.status, 201);
  const receipt = await result.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["created_at", "id", "number"]);
  const detail = await (await f.request(`/issues/${receipt.id}`)).json();
  assert.equal(detail.assignee_id, null);
  assert.equal(detail.priority, "普通");
  assert.equal(detail.status, "待处理");
  assert.equal(detail.source_system, "测试系统");
  assert.equal(detail.reporter_name, "虚构客户");
  assert.equal(
    (
      await external("/issues", {
        feature_id: one.feature.id,
        title: "反馈",
        description: "不应传Token",
        source_path: "/report?token=not-real",
      })
    ).status,
    400,
  );
});

test("外部图片批量提交可幂等重试，重复提交不会重复写问题或图片", async (t) => {
  const f = await fixture(t);
  const { project, feature } = await f.setup();
  const integration = await (
    await f.request(`/projects/${project.id}/integrations`, "POST", {
      name: "测试接入",
    })
  ).json();
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#eee" },
  })
    .png()
    .toBuffer();
  function form(description = "带两张截图") {
    const body = new FormData();
    body.append(
      "data",
      JSON.stringify({ feature_id: feature.id, title: "多图", description }),
    );
    for (let i = 0; i < 2; i++)
      body.append(
        "images",
        new Blob([new Uint8Array(buffer)], { type: "image/png" }),
        `image-${i}.png`,
      );
    return body;
  }
  const headers = {
    Authorization: `Bearer ${integration.api_key}`,
    "Idempotency-Key": "stable-request-0002",
  };
  const send = (body: FormData) =>
    fetch(`${f.base}/api/external/v1/issues`, {
      method: "POST",
      headers,
      body,
    });
  const first = await send(form());
  assert.equal(first.status, 201);
  const receipt = await first.json();
  const retry = await send(form());
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), receipt);
  const concurrent = await Promise.all([send(form()), send(form())]);
  assert(concurrent.every((r) => r.status === 200));
  assert.equal((await send(form("不同内容"))).status, 409);
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 2);
  assert.equal(
    (await (await f.request(`/projects/${project.id}/issues`)).json()).length,
    1,
  );
});

test("只有管理员可管理接入；凭据不明文存储，停用或归档立即阻止提交", async (t) => {
  const f = await fixture(t);
  const { project } = await f.setup();
  const memberLogin = await f.request(
    "/auth/login",
    "POST",
    { username: "member", password },
    null,
  );
  const cookie = memberLogin.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await f.request(
        `/projects/${project.id}/integrations`,
        "POST",
        { name: "不能创建" },
        cookie,
      )
    ).status,
    403,
  );
  const integration = await (
    await f.request(`/projects/${project.id}/integrations`, "POST", {
      name: "可撤销",
    })
  ).json();
  const listed = await (
    await f.request(`/projects/${project.id}/integrations`)
  ).json();
  assert(!JSON.stringify(listed).includes(integration.api_key));
  const stored = f.db
    .prepare("SELECT key_hash FROM integrations WHERE id=?")
    .get(integration.id)!;
  assert.notEqual(stored.key_hash, integration.api_key);
  const headers = { Authorization: `Bearer ${integration.api_key}` };
  await f.request(`/projects/${project.id}`, "PATCH", {
    name: project.name,
    description: "",
    archived: true,
  });
  assert.equal(
    (await fetch(`${f.base}/api/external/v1/features`, { headers })).status,
    409,
  );
  await f.request(
    `/projects/${project.id}/integrations/${integration.id}/revoke`,
    "POST",
    {},
  );
  assert.equal(
    (await fetch(`${f.base}/api/external/v1/features`, { headers })).status,
    401,
  );
  assert.equal((await f.request("/external/v1/features")).status, 401);
});
