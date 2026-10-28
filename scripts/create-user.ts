import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { openDatabase, createUser } from "../server/db.ts";
const args = process.argv.slice(2);
const arg = (name: string) => args[args.indexOf(name) + 1];
const username = args.includes("--username") ? arg("--username") : "admin";
const name = args.includes("--name") ? arg("--name") : "管理员";
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: stdin, output, terminal: !!stdin.isTTY });
const db = openDatabase(process.env.DATA_DIR ?? "./data");
try {
  let password = process.env.RECTIFY_BOOTSTRAP_PASSWORD;
  if (!password) {
    if (!stdin.isTTY)
      throw new Error(
        "非交互环境请通过环境变量 RECTIFY_BOOTSTRAP_PASSWORD 提供密码",
      );
    stdout.write("设置密码（至少12位，输入不显示）：");
    muted = true;
    password = await rl.question("");
    muted = false;
    stdout.write("\n再次输入密码：");
    muted = true;
    const confirm = await rl.question("");
    muted = false;
    stdout.write("\n");
    if (password !== confirm) throw new Error("两次密码不一致");
  }
  await createUser(db, username, name, password, "admin");
  console.log(`管理员 ${username} 已创建。请使用该账号登录。`);
} catch (e) {
  console.error(
    e instanceof Error && !e.message.includes("UNIQUE")
      ? e.message
      : "账号已存在，未作修改",
  );
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
