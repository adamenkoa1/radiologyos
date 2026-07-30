import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.env.RADIOLOGYOS_BOOTSTRAP_PASSWORD || "";
// Спрощено: 6-значний PIN або пароль 6–200 символів.
if (!(/^\d{6}$/.test(password) || (password.length >= 6 && password.length <= 200))) {
  console.error(
    "Set RADIOLOGYOS_BOOTSTRAP_PASSWORD to a 6-digit PIN (e.g. 428193) or a 6–200 character password.",
  );
  process.exit(1);
}

const iterations = 600_000;
const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
process.stdout.write(
  `pbkdf2$sha256$${iterations}$${salt.toString("base64")}$${derived.toString("base64")}\n`,
);
