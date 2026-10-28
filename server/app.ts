import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase, createUser, type DB } from "./db.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { summarizeIssueTitle } from "./issue-title.ts";
import {
  registerExternalRoutes,
  registerIntegrationAdminRoutes,
} from "./integrations.ts";
import {
  ISSUE_TYPES,
  PRIORITIES,
  STATUSES,
  VERIFICATIONS,
  type User,
  type Issue,
} from "../shared/types.ts";

const cookieName = "rectify_session";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const text = (max: number) => z.string().trim().min(1).max(max);
const date = z
  .string()
  .refine(
    (v) =>
      v === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !isNaN(Date.parse(v)) &&
        new Date(v).toISOString().startsWith(v)),
    "日期无效",
  );
const issueSchema = z.object({
  feature_id: z.uuid(),
  title: text(120),
  description: text(10000),
  type: z.enum(ISSUE_TYPES),
  priority: z.enum(PRIORITIES).default("普通"),
  assignee_id: z.uuid().nullable().default(null),
  due_date: date.default(""),
});
const updateSchema = issueSchema.extend({
  version: z.number().int().positive(),
  status: z.enum(STATUSES),
  resolution: z.string().trim().max(10000),
  verification: z.enum(VERIFICATIONS),
});
const registrationSchema = issueSchema
  .pick({ feature_id: true, title: true, description: true, type: true })
  .extend({ title: text(120).optional() })
  .strict();
const issueSelect = `SELECT i.*, f.name feature_name, u.name assignee_name,
  g.name source_system, x.reporter_name, x.source_path,
  (SELECT COUNT(*) FROM attachments a WHERE a.issue_id=i.id) attachment_count
  FROM issues i JOIN features f ON f.id=i.feature_id LEFT JOIN users u ON u.id=i.assignee_id
  LEFT JOIN external_submissions x ON x.issue_id=i.id LEFT JOIN integrations g ON g.id=x.integration_id`;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
function transaction<T>(db: DB, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function filename(value: string) {
  return value.replace(/[\x00-\x1f/\\]/g, "").slice(0, 150) || "图片";
}

export function createApp(options: {
  dataDir: string;
  production?: boolean;
  secureCookies?: boolean;
  trustProxy?: number | string | string[];
  revision?: string;
  webDir?: string;
}) {
  const db = openDatabase(options.dataDir);
  const uploads = resolve(options.dataDir, "uploads");
  mkdirSync(uploads, { recursive: true, mode: 0o700 });
  const app = express();
  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: options.production
        ? { directives: { imgSrc: ["'self'", "data:", "blob:"] } }
        : false,
      strictTransportSecurity: options.production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, revision: options.revision ?? "development" }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 6,
      fileSize: 8 * 1024 * 1024,
      fields: 2,
      fieldSize: 64000,
    },
    fileFilter: (_req, file, cb) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
        cb(new HttpError(400, "仅支持 PNG、JPG、WebP 图片"));
      else cb(null, true);
    },
  }).array("images", 6);
  registerExternalRoutes(app, {
    db,
    upload,
    fail,
    project,
    transaction: (action) => transaction(db, action),
    validateReferences,
    prepareImages,
    storeImages,
    cleanup,
    activity,
  });
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("X-Rectify-Request") !== "1" ||
        req.get("Sec-Fetch-Site") === "cross-site")
    )
      fail(403, "请从系统页面发起操作");
    next();
  });
  app.get("/api/auth/session", (req, res) => {
    const user = sessionUser(req);
    res.json({
      user: user || null,
      configured: !!db.prepare("SELECT id FROM users LIMIT 1").get(),
    });
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "登录尝试过多，请15分钟后重试" },
  });
  app.post("/api/auth/login", loginLimit, async (req, res) => {
    const data = z
      .object({ username: text(40), password: z.string().min(1).max(128) })
      .parse(req.body);
    const row = db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(data.username.toLowerCase()) as
      (User & { password_hash: string }) | undefined;
    const valid = await verifyPassword(
      data.password,
      row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!row || !valid) fail(401, "账号或密码不正确");
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      digest(token),
      row.id,
      Date.now() + 7 * 86400000,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: options.secureCookies ?? !!options.production,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400000,
    });
    res.json({ user: publicUser(row) });
  });
  app.use("/api", (req, res, next) => {
    const user = sessionUser(req);
    if (!user) fail(401, "请先登录");
    res.locals.user = user;
    next();
  });
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      digest(tokenFrom(req)),
    );
    res
      .clearCookie(cookieName, {
        path: "/",
        secure: options.secureCookies ?? !!options.production,
        httpOnly: true,
        sameSite: "lax",
      })
      .json({ ok: true });
  });
  registerIntegrationAdminRoutes(app, { db, fail, project });
  app.post("/api/auth/password", loginLimit, async (req, res) => {
    const data = z
      .object({
        current: z.string().min(1).max(128),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(res.locals.user.id) as { password_hash: string };
    if (!(await verifyPassword(data.current, row.password_hash)))
      fail(400, "原密码不正确");
    const hash = await hashPassword(data.password);
    transaction(db, () => {
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
        hash,
        res.locals.user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(
        res.locals.user.id,
      );
    });
    res.clearCookie(cookieName, { path: "/" }).json({ ok: true });
  });
  app.get("/api/users", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id, username, name, role FROM users ORDER BY created_at",
        )
        .all(),
    ),
  );
  app.post("/api/users", async (req, res) => {
    if (res.locals.user.role !== "admin") fail(403, "只有管理员可以添加成员");
    const data = z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),
        name: text(50),
        password: z.string().min(12).max(128),
        role: z.enum(["admin", "member"]).default("member"),
      })
      .parse(req.body);
    if (
      db
        .prepare("SELECT id FROM users WHERE username=?")
        .get(data.username.toLowerCase())
    )
      fail(409, "账号已存在");
    res
      .status(201)
      .json(
        await createUser(
          db,
          data.username,
          data.name,
          data.password,
          data.role,
        ),
      );
  });
  app.get("/api/projects", (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT p.*,
    (SELECT COUNT(*) FROM issues i WHERE i.project_id=p.id) issue_count,
    (SELECT COUNT(*) FROM issues i WHERE i.project_id=p.id AND status!='已关闭') open_count
    FROM projects p ORDER BY archived, created_at DESC`,
        )
        .all(),
    ),
  );
  app.post("/api/projects", (req, res) => {
    const data = z
      .object({
        name: text(80),
        description: z.string().trim().max(1000).default(""),
        features: z.array(text(80)).max(100).default([]),
      })
      .parse(req.body);
    const id = randomUUID();
    transaction(db, () => {
      db.prepare("INSERT INTO projects VALUES (?, ?, ?, 0, ?)").run(
        id,
        data.name,
        data.description,
        new Date().toISOString(),
      );
      for (const name of new Set(data.features))
        db.prepare("INSERT INTO features VALUES (?, ?, ?)").run(
          randomUUID(),
          id,
          name,
        );
    });
    res
      .status(201)
      .json(db.prepare("SELECT * FROM projects WHERE id=?").get(id));
  });
  app.patch("/api/projects/:id", (req, res) => {
    project(req.params.id);
    const data = z
      .object({
        name: text(80),
        description: z.string().trim().max(1000),
        archived: z.boolean(),
      })
      .parse(req.body);
    db.prepare(
      "UPDATE projects SET name=?, description=?, archived=? WHERE id=?",
    ).run(data.name, data.description, Number(data.archived), req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/features", (req, res) => {
    project(req.params.id);
    res.json(
      db
        .prepare("SELECT * FROM features WHERE project_id=? ORDER BY name")
        .all(req.params.id),
    );
  });
  app.post("/api/projects/:id/features", (req, res) => {
    project(req.params.id, true);
    const { name } = z.object({ name: text(80) }).parse(req.body);
    const existing = db
      .prepare("SELECT * FROM features WHERE project_id=? AND name=?")
      .get(req.params.id, name);
    if (existing) return res.json(existing);
    const id = randomUUID();
    db.prepare("INSERT INTO features VALUES (?, ?, ?)").run(
      id,
      req.params.id,
      name,
    );
    res.status(201).json({ id, project_id: req.params.id, name });
  });
  app.patch("/api/projects/:id/features/:feature", (req, res) => {
    project(req.params.id, true);
    const { name } = z.object({ name: text(80) }).parse(req.body);
    if (
      !db
        .prepare("SELECT id FROM features WHERE id=? AND project_id=?")
        .get(req.params.feature, req.params.id)
    )
      fail(404, "功能项不存在");
    if (
      db
        .prepare(
          "SELECT id FROM features WHERE project_id=? AND name=? AND id!=?",
        )
        .get(req.params.id, name, req.params.feature)
    )
      fail(409, "该功能项名称已存在");
    db.prepare("UPDATE features SET name=? WHERE id=?").run(
      name,
      req.params.feature,
    );
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/issues", (req, res) => {
    project(req.params.id);
    res.json(
      db
        .prepare(
          `${issueSelect} WHERE i.project_id=? ORDER BY i.updated_at DESC, i.number DESC`,
        )
        .all(req.params.id),
    );
  });
  const uploadLimit = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "图片提交过于频繁，请稍后再试" },
  });
  app.post(
    "/api/projects/:id/issues",
    (req, _res, next) => {
      project(String(req.params.id), true);
      next();
    },
    uploadLimit,
    upload,
    async (req, res) => {
      const data = registrationSchema.parse(parsePayload(req));
      const projectId = req.params.id as string;
      validateReferences(projectId, data.feature_id, null);
      const images = await prepareImages(req);
      const id = randomUUID();
      try {
        transaction(db, () => {
          project(projectId, true);
          const count = db
            .prepare(
              "SELECT COALESCE(MAX(number), 0)+1 n FROM issues WHERE project_id=?",
            )
            .get(projectId) as { n: number };
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO issues (id,number,project_id,feature_id,title,description,type,priority,assignee_id,due_date,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            id,
            count.n,
            projectId,
            data.feature_id,
            data.title ?? summarizeIssueTitle(data.description),
            data.description,
            data.type,
            "普通",
            null,
            "",
            now,
            now,
          );
          storeImages(id, images);
          activity(id, res.locals.user.id, "登记了问题");
        });
      } catch (e) {
        cleanup(images);
        throw e;
      }
      res.status(201).json(detail(id));
    },
  );
  app.get("/api/issues/:id", (req, res) => res.json(detail(req.params.id)));
  app.patch("/api/issues/:id", (req, res) => {
    const current = issue(req.params.id, true);
    const data = updateSchema.parse(req.body);
    if (data.version !== current.version)
      fail(409, "其他成员已更新此问题，请重新打开后再修改");
    validateReferences(current.project_id, data.feature_id, data.assignee_id);
    if (["待复验", "已关闭"].includes(data.status) && !data.resolution)
      fail(400, "请先填写整改措施，再提交复验或关闭");
    if (data.status === "已关闭" && data.verification !== "通过")
      fail(400, "复验通过后才能关闭问题");
    if (
      data.verification === "不通过" &&
      !["待处理", "处理中"].includes(data.status)
    )
      fail(400, "复验不通过时，请退回待处理或处理中");
    const completed = ["待复验", "已关闭"].includes(data.status)
      ? current.completed_at || new Date().toISOString()
      : null;
    const labels: Record<string, string> = {
      title: "标题",
      description: "问题描述",
      feature_id: "功能项",
      type: "问题类型",
      priority: "优先级",
      assignee_id: "责任人",
      due_date: "计划完成日期",
      resolution: "整改措施",
      verification: "复验结果",
    };
    const changed = Object.entries(labels)
      .filter(
        ([key]) =>
          data[key as keyof typeof data] !== current[key as keyof Issue],
      )
      .map(([, label]) => label);
    const message =
      [
        current.status !== data.status
          ? `状态：${current.status} → ${data.status}`
          : "",
        changed.length ? `更新了${changed.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("；") || "保存了问题";
    transaction(db, () => {
      db.prepare(
        `UPDATE issues SET feature_id=?, title=?, description=?, type=?, status=?, priority=?, assignee_id=?, due_date=?, resolution=?, verification=?, completed_at=?, updated_at=?, version=version+1 WHERE id=?`,
      ).run(
        data.feature_id,
        data.title,
        data.description,
        data.type,
        data.status,
        data.priority,
        data.assignee_id,
        data.due_date,
        data.resolution,
        data.verification,
        completed,
        new Date().toISOString(),
        current.id,
      );
      activity(current.id, res.locals.user.id, message);
    });
    res.json(detail(current.id));
  });
  app.post("/api/issues/:id/comments", (req, res) => {
    const current = issue(req.params.id, true);
    const { message } = z.object({ message: text(2000) }).parse(req.body);
    transaction(db, () => {
      activity(current.id, res.locals.user.id, `留言：${message}`);
      touch(current.id);
    });
    res.status(201).json(detail(current.id));
  });
  app.post(
    "/api/issues/:id/attachments",
    (req, _res, next) => {
      issue(String(req.params.id), true);
      next();
    },
    uploadLimit,
    upload,
    async (req, res) => {
      const current = issue(req.params.id as string, true);
      const images = await prepareImages(req);
      if (!images.length) fail(400, "请选择图片");
      try {
        transaction(db, () => {
          issue(current.id, true);
          const count = db
            .prepare("SELECT COUNT(*) n FROM attachments WHERE issue_id=?")
            .get(current.id) as { n: number };
          if (count.n + images.length > 6) fail(400, "每个问题最多6张图片");
          storeImages(current.id, images);
          activity(
            current.id,
            res.locals.user.id,
            `添加了${images.length}张图片`,
          );
          touch(current.id);
        });
      } catch (e) {
        cleanup(images);
        throw e;
      }
      res.status(201).json(detail(current.id));
    },
  );
  app.get("/api/attachments/:id", (req, res) => {
    const record = db
      .prepare("SELECT * FROM attachments WHERE id=?")
      .get(req.params.id);
    if (!record) fail(404, "图片不存在");
    res.type("webp").sendFile(join(uploads, `${record.id}.webp`));
  });
  app.delete("/api/attachments/:id", (req, res) => {
    const record = db
      .prepare("SELECT * FROM attachments WHERE id=?")
      .get(req.params.id);
    if (!record) fail(404, "图片不存在");
    issue(String(record.issue_id), true);
    transaction(db, () => {
      db.prepare("DELETE FROM attachments WHERE id=?").run(req.params.id);
      activity(
        String(record.issue_id),
        res.locals.user.id,
        `移除了图片“${record.name}”`,
      );
      touch(String(record.issue_id));
    });
    try {
      unlinkSync(join(uploads, `${record.id}.webp`));
    } catch {
      /* 未引用文件可在停机备份时清理。 */
    }
    res.json({ ok: true });
  });
  app.use("/api", (_req, _res) => fail(404, "接口不存在"));
  const webDir = resolve(options.webDir ?? "dist");
  if (existsSync(join(webDir, "index.html"))) {
    app.use(express.static(webDir));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(join(webDir, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: "请检查必填内容、字数和选项",
          fields: error.issues.map((i) => i.path.join(".")),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof multer.MulterError)
        return res
          .status(400)
          .json({ error: "上传超出限制：每个问题最多6张图片，每张不超过8MB" });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "提交数据格式不正确" });
      console.error(
        "请求失败",
        error instanceof Error ? error.name : "UnknownError",
      );
      res.status(500).json({ error: "操作未完成，请稍后重试" });
    },
  );
  function tokenFrom(req: Request) {
    return (
      req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? ""
    );
  }
  function publicUser(row: User): User {
    return {
      id: row.id,
      username: row.username,
      name: row.name,
      role: row.role,
    };
  }
  function sessionUser(req: Request): User | undefined {
    const row = db
      .prepare(
        "SELECT u.id, u.username, u.name, u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
      )
      .get(digest(tokenFrom(req)), Date.now());
    return row as unknown as User | undefined;
  }
  function project(id: string, write = false) {
    const row = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!row) fail(404, "项目不存在");
    if (write && row.archived) fail(409, "项目已归档，请先恢复项目");
    return row;
  }
  function issue(id: string, write = false): Issue {
    const row = db.prepare(`${issueSelect} WHERE i.id=?`).get(id) as unknown as
      Issue | undefined;
    if (!row) fail(404, "问题不存在");
    project(row.project_id, write);
    return row;
  }
  function detail(id: string) {
    return {
      ...issue(id),
      attachments: db
        .prepare(
          "SELECT * FROM attachments WHERE issue_id=? ORDER BY created_at",
        )
        .all(id),
      activities: db
        .prepare(
          "SELECT a.*, u.name actor_name FROM activities a JOIN users u ON u.id=a.actor_id WHERE issue_id=? ORDER BY a.rowid DESC",
        )
        .all(id),
    };
  }
  function validateReferences(
    projectId: string,
    featureId: string,
    userId: string | null,
  ) {
    if (
      !db
        .prepare("SELECT id FROM features WHERE id=? AND project_id=?")
        .get(featureId, projectId)
    )
      fail(400, "请选择当前项目的功能项");
    if (userId && !db.prepare("SELECT id FROM users WHERE id=?").get(userId))
      fail(400, "责任人不存在");
  }
  function activity(issueId: string, actor: string, message: string) {
    db.prepare("INSERT INTO activities VALUES (?, ?, ?, ?, ?)").run(
      randomUUID(),
      issueId,
      actor,
      message,
      new Date().toISOString(),
    );
  }
  function touch(issueId: string) {
    db.prepare(
      "UPDATE issues SET updated_at=?, version=version+1 WHERE id=?",
    ).run(new Date().toISOString(), issueId);
  }
  function parsePayload(req: Request) {
    return req.is("multipart/form-data")
      ? JSON.parse(req.body.data ?? "{}")
      : req.body;
  }
  async function prepareImages(req: Request) {
    const results: { id: string; name: string; buffer: Buffer }[] = [];
    for (const file of (req.files as Express.Multer.File[] | undefined) ?? []) {
      try {
        const image = sharp(file.buffer, {
          limitInputPixels: 20000000,
          failOn: "error",
        });
        const meta = await image.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
          fail(400, "图片内容与支持格式不符");
        const buffer = await image
          .rotate()
          .resize({
            width: 2560,
            height: 2560,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer();
        results.push({
          id: randomUUID(),
          name: filename(file.originalname),
          buffer,
        });
      } catch {
        fail(
          400,
          "图片无法读取或尺寸过大，请使用有效的 PNG、JPG、WebP（不超过2000万像素）",
        );
      }
    }
    return results;
  }
  function storeImages(
    issueId: string,
    images: { id: string; name: string; buffer: Buffer }[],
  ) {
    for (const image of images) {
      writeFileSync(join(uploads, `${image.id}.webp`), image.buffer, {
        flag: "wx",
        mode: 0o600,
      });
      db.prepare("INSERT INTO attachments VALUES (?, ?, ?, ?, ?)").run(
        image.id,
        issueId,
        image.name,
        image.buffer.length,
        new Date().toISOString(),
      );
    }
  }
  function cleanup(images: { id: string }[]) {
    for (const image of images) {
      try {
        unlinkSync(join(uploads, `${image.id}.webp`));
      } catch {
        /* 事务回滚时可能尚未写入。 */
      }
    }
  }
  return { app, db };
}
