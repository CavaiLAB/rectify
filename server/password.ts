import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = await derive(password, salt);
  const hash = Buffer.from(expected, "hex");
  return hash.length === actual.length && timingSafeEqual(hash, actual);
}
