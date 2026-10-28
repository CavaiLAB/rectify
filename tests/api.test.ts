import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { createApp } from "../server/app.ts";
import { createUser, openDatabase } from "../server/db.ts";
import type { Feature, IssueDetail, Project } from "../shared/types.ts";

const password = "test-only-password-2026";
async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "rectify-api-test-"));
  const { app, db } = createApp({ dataDir: dir });
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
    db.close();
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
    assignee_id: f.member.id,
  });
  assert.equal(result.status, 201);
  const issue = await result.json();
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "待处理");
  assert.equal(issue.assignee_name, "测试成员");
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
