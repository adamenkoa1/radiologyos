import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.env.RADIOLOGYOS_BOOTSTRAP_PASSWORD || "";
if (
  password.length < 12
  || password.length > 200
  || !/[A-Za-zА-Яа-яЇїІіЄєҐґ]/u.test(password)
  || !/\d/.test(password)
) {
  console.error(
    "Set RADIOLOGYOS_BOOTSTRAP_PASSWORD to a 12–200 character password containing a letter and a digit.",
  );
  process.exit(1);
}

const iterations = 600_000;
const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
process.stdout.write(
  `pbkdf2$sha256$${iterations}$${salt.toString("base64")}$${derived.toString("base64")}\n`,
);
