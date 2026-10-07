// Django password hashes (port of lp_auth::password): verify argon2id,
// pbkdf2_sha256 and pbkdf2_sha1; hash new ones as Django-format Argon2id.
import { pbkdf2, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    if (encoded.startsWith("argon2$")) {
      // Django stores "argon2" + PHC string: argon2$argon2id$v=19$m=..,t=..,p=..$salt$hash
      return await Bun.password.verify(password, encoded.slice("argon2".length));
    }
    for (const [prefix, digest, len] of [
      ["pbkdf2_sha256$", "sha256", 32],
      ["pbkdf2_sha1$", "sha1", 20],
    ] as const) {
      if (!encoded.startsWith(prefix)) continue;
      const [iter, salt, expected] = encoded.slice(prefix.length).split("$", 3);
      const n = Number(iter);
      if (!Number.isInteger(n) || !salt || !expected) return false;
      const out = (await pbkdf2Async(password, salt, n, len, digest)).toString("base64");
      const a = Buffer.from(out);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    }
  } catch {
    return false;
  }
  return false;
}

/** Django-format Argon2id (m=102400, t=2, p=8 like Django's default hasher). */
export async function hashPassword(password: string): Promise<string> {
  // Bun.password has no parallelism knob (p=1); Django verifies any p.
  const phc = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 102400, timeCost: 2 });
  return "argon2" + phc;
}
