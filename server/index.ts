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
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
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
