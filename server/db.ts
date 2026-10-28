import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./password.ts";

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "rectify.db"));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, number INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
      feature_id TEXT NOT NULL REFERENCES features(id), title TEXT NOT NULL, description TEXT NOT NULL,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待处理', priority TEXT NOT NULL DEFAULT '普通',
      assignee_id TEXT REFERENCES users(id), due_date TEXT NOT NULL DEFAULT '', resolution TEXT NOT NULL DEFAULT '',
      verification TEXT NOT NULL DEFAULT '未复验', completed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(project_id, number)
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), name TEXT NOT NULL,
      size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), actor_id TEXT NOT NULL REFERENCES users(id),
      message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE, key_hint TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS external_submissions (
      issue_id TEXT PRIMARY KEY REFERENCES issues(id), integration_id TEXT NOT NULL REFERENCES integrations(id),
      request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, reporter_id TEXT NOT NULL DEFAULT '',
      reporter_name TEXT NOT NULL DEFAULT '', source_path TEXT NOT NULL DEFAULT '',
      UNIQUE(integration_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_issue_project ON issues(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_attachment_issue ON attachments(issue_id);
    CREATE INDEX IF NOT EXISTS idx_activity_issue ON activities(issue_id);
    CREATE INDEX IF NOT EXISTS idx_session_expiry ON sessions(expires_at);
  `);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export async function createUser(
  db: DB,
  username: string,
  name: string,
  password: string,
  role = "member",
) {
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))
    throw new Error("账号需为3–40位字母、数字、点、横线或下划线");
  if (!name.trim() || name.length > 50) throw new Error("姓名需为1–50字");
  if (password.length < 12 || password.length > 128)
    throw new Error("密码需为12–128位");
  if (!["admin", "member"].includes(role)) throw new Error("角色不合法");
  const id = randomUUID();
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    username.toLowerCase(),
    name.trim(),
    hash,
    role,
    new Date().toISOString(),
  );
  return { id, username: username.toLowerCase(), name: name.trim(), role };
}
