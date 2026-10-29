import { createApp } from "./app.ts";
import { attachmentStoreFromEnv } from "./attachment-storage.ts";
const port = Number(process.env.PORT ?? 3188);
const host = process.env.HOST ?? "127.0.0.1";
const dataDir = process.env.DATA_DIR ?? "./data";
const { app, close } = createApp({
  dataDir,
  attachmentStore: attachmentStoreFromEnv(dataDir),
  production: process.env.NODE_ENV === "production",
  secureCookies:
    process.env.COOKIE_SECURE === undefined
      ? undefined
      : process.env.COOKIE_SECURE === "true",
  trustProxy:
    process.env.TRUSTED_PROXIES !== undefined
      ? process.env.TRUSTED_PROXIES.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : Number(process.env.TRUST_PROXY ?? 0),
  revision: process.env.APP_REVISION,
});
const server = app.listen(port, host, () =>
  console.log(`Rectify: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await close();
      process.exit(0);
    }),
  );
