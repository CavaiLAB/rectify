import { createApp } from "./app.ts";
const port = Number(process.env.PORT ?? 3188);
const host = process.env.HOST ?? "127.0.0.1";
const { app, db } = createApp({
  dataDir: process.env.DATA_DIR ?? "./data",
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
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
