import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { createUser } from "../server/db.ts";
const directory = mkdtempSync(join(tmpdir(), "rectify-browser-test-"));
const { app, db } = createApp({ dataDir: directory });
await createUser(db, "tester", "验收成员", "browser-test-only-2026", "admin");
const server = app.listen(4199, "127.0.0.1", () =>
  console.log("独立浏览器测试服务: http://127.0.0.1:4199"),
);
function stop() {
  server.closeAllConnections();
  server.close(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
