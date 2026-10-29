import {
  Router,
  type Express,
  type Request,
  type RequestHandler,
} from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { DB } from "./db.ts";
import { ISSUE_TYPES } from "../shared/types.ts";
import { summarizeIssueTitle } from "./issue-title.ts";
import type { PreparedImage, StagedImage } from "./attachments.ts";

interface Integration {
  id: string;
  project_id: string;
  name: string;
  created_by: string;
}
interface Services {
  db: DB;
  upload: RequestHandler;
  fail: (status: number, message: string) => never;
  project: (id: string, write?: boolean) => unknown;
  transaction: <T>(action: () => T) => T;
  validateReferences: (
    projectId: string,
    featureId: string,
    userId: string | null,
  ) => void;
  prepareImages: (req: Request) => Promise<PreparedImage[]>;
  stageImages: (images: PreparedImage[]) => Promise<StagedImage[]>;
  storeImages: (issueId: string, images: StagedImage[]) => void;
  cleanup: (images: StagedImage[]) => Promise<void>;
  activity: (issueId: string, actor: string, message: string) => void;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const submission = z
  .object({
    feature_id: z.uuid(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(10000),
    type: z.enum(ISSUE_TYPES).default("问题缺陷"),
    reporter_id: z.string().trim().max(100).default(""),
    reporter_name: z.string().trim().max(100).default(""),
    source_path: z
      .string()
      .max(500)
      .refine(
        (p) =>
          !p ||
          (p.startsWith("/") && !p.startsWith("//") && !/[?#\r\n]/.test(p)),
        "仅传递页面路径，不含查询参数、令牌或片段",
      )
      .default(""),
  })
  .strict();

export function registerExternalRoutes(app: Express, s: Services) {
  const router = Router();
  const { db, fail } = s;
  const authLimit = rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "请求过于频繁，请稍后重试" },
  });
  router.use(authLimit, (req, res, next) => {
    const auth = req.get("Authorization") ?? "";
    if (!/^Bearer rct_[A-Za-z0-9_-]{43}$/.test(auth)) fail(401, "接入凭据无效");
    const integration = db
      .prepare(
        "SELECT id,project_id,name,created_by FROM integrations WHERE key_hash=? AND enabled=1",
      )
      .get(hash(auth.slice(7))) as unknown as Integration | undefined;
    if (!integration) return fail(401, "接入凭据无效或已停用");
    s.project(integration.project_id, true);
    res.locals.integration = integration;
    next();
  });
  router.get("/features", (_req, res) => {
    const integration = res.locals.integration as Integration;
    const project = db
      .prepare("SELECT name FROM projects WHERE id=?")
      .get(integration.project_id)!;
    res.json({
      project_name: project.name,
      features: db
        .prepare(
          "SELECT id,name FROM features WHERE project_id=? ORDER BY name",
        )
        .all(integration.project_id),
    });
  });
  router.post(
    "/issues",
    rateLimit({
      windowMs: 60000,
      limit: 30,
      keyGenerator: (_req, res) => res.locals.integration.id,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "提交过于频繁，请稍后重试" },
    }),
    s.upload,
    async (req, res) => {
      const integration = res.locals.integration as Integration;
      const data = submission.parse(
        req.is("multipart/form-data")
          ? JSON.parse(req.body.data ?? "{}")
          : req.body,
      );
      const requestId = z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,100}$/)
        .parse(req.get("Idempotency-Key"));
      s.validateReferences(integration.project_id, data.feature_id, null);
      const fingerprint = createHash("sha256").update(JSON.stringify(data));
      for (const file of (req.files as Express.Multer.File[] | undefined) ??
        []) {
        fingerprint.update(
          JSON.stringify({
            name: file.originalname,
            type: file.mimetype,
            size: file.size,
          }),
        );
        fingerprint.update(createHash("sha256").update(file.buffer).digest());
      }
      const payloadHash = fingerprint.digest("hex");
      function existing() {
        const previous = db
          .prepare(
            "SELECT issue_id,fingerprint FROM external_submissions WHERE integration_id=? AND request_id=?",
          )
          .get(integration.id, requestId);
        if (!previous) return undefined;
        if (previous.fingerprint !== payloadHash)
          fail(409, "提交标识已用于不同内容，请生成新的提交标识");
        return receipt(String(previous.issue_id));
      }
      const reused = existing();
      if (reused) return res.json(reused);
      const images = await s.stageImages(await s.prepareImages(req));
      try {
        const result = s.transaction(() => {
          if (
            !db
              .prepare("SELECT id FROM integrations WHERE id=? AND enabled=1")
              .get(integration.id)
          )
            fail(401, "接入已停用");
          s.project(integration.project_id, true);
          const repeated = existing();
          if (repeated) return { created: false, receipt: repeated };
          const id = randomUUID();
          const now = new Date().toISOString();
          const number = db
            .prepare(
              "SELECT COALESCE(MAX(number),0)+1 n FROM issues WHERE project_id=?",
            )
            .get(integration.project_id)!.n;
          db.prepare(
            `INSERT INTO issues(id,number,project_id,feature_id,title,description,type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
          ).run(
            id,
            number,
            integration.project_id,
            data.feature_id,
            data.title ?? summarizeIssueTitle(data.description),
            data.description,
            data.type,
            now,
            now,
          );
          db.prepare(
            "INSERT INTO external_submissions VALUES(?,?,?,?,?,?,?)",
          ).run(
            id,
            integration.id,
            requestId,
            payloadHash,
            data.reporter_id,
            data.reporter_name,
            data.source_path,
          );
          s.storeImages(id, images);
          s.activity(
            id,
            integration.created_by,
            `收到来自「${integration.name}」的客户反馈${data.reporter_name ? `（提交人：${data.reporter_name}）` : ""}`,
          );
          db.prepare("UPDATE integrations SET last_used_at=? WHERE id=?").run(
            now,
            integration.id,
          );
          return { created: true, receipt: receipt(id) };
        });
        if (!result.created) await s.cleanup(images);
        res.status(result.created ? 201 : 200).json(result.receipt);
      } catch (error) {
        await s.cleanup(images);
        throw error;
      }
    },
  );
  router.use((_req, _res) => fail(404, "外部接口仅支持功能项读取与问题提交"));
  // 此路由只认项目专用 Bearer 凭据，不使用管理后台 Cookie，也不开放跨域访问。
  app.use("/api/external/v1", router);
  function receipt(id: string) {
    return db
      .prepare("SELECT id,number,created_at FROM issues WHERE id=?")
      .get(id);
  }
}

export function registerIntegrationAdminRoutes(
  app: Express,
  s: Pick<Services, "db" | "fail" | "project">,
) {
  const { db, fail } = s;
  const admin: RequestHandler = (_req, res, next) => {
    if (res.locals.user.role !== "admin")
      fail(403, "只有管理员可以管理外部接入");
    next();
  };
  app.get("/api/projects/:id/integrations", admin, (req, res) => {
    s.project(String(req.params.id));
    res.json(
      db
        .prepare(
          "SELECT id,name,key_hint,enabled,created_at,last_used_at FROM integrations WHERE project_id=? ORDER BY created_at DESC",
        )
        .all(String(req.params.id)),
    );
  });
  app.post("/api/projects/:id/integrations", admin, (req, res) => {
    s.project(String(req.params.id), true);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .parse(req.body);
    const key = `rct_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO integrations(id,project_id,name,key_hash,key_hint,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      String(req.params.id),
      name,
      hash(key),
      `${key.slice(0, 8)}…${key.slice(-4)}`,
      res.locals.user.id,
      new Date().toISOString(),
    );
    res.status(201).json({ id, name, api_key: key });
  });
  app.post(
    "/api/projects/:id/integrations/:integration/revoke",
    admin,
    (req, res) => {
      s.project(String(req.params.id));
      const result = db
        .prepare(
          "UPDATE integrations SET enabled=0 WHERE id=? AND project_id=?",
        )
        .run(String(req.params.integration), String(req.params.id));
      if (!result.changes) fail(404, "接入不存在");
      res.json({ ok: true });
    },
  );
}
