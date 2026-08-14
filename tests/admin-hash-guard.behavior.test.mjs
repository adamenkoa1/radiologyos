import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const COMPROMISED = "pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc=";
const VALID = "pbkdf2$sha256$100000$IWyZk/j3/iTwDlSzXLkzAw==$RokqUfcf533IH0DSwOBb0yLoQvd1qBQ6E0Pp5xCzE5A=";

const SQL = `WITH admins AS (
  SELECT password_hash,
         substr(password_hash,15,instr(substr(password_hash,15),'$')-1) AS iterations
  FROM staff_members
  WHERE role = 'admin' AND active = 1
)
SELECT COUNT(*) AS secure_admins
FROM admins
WHERE substr(password_hash,1,14) = 'pbkdf2$sha256$'
  AND length(password_hash) - length(replace(password_hash,'$','')) = 4
  AND iterations <> ''
  AND iterations NOT GLOB '*[^0-9]*'
  AND CAST(iterations AS INTEGER) >= 1000
  AND length(password_hash) >= 80
  AND password_hash NOT IN (?);`;

function secureCount(hash) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE staff_members (role TEXT, active INTEGER, password_hash TEXT)");
  db.prepare("INSERT INTO staff_members (role, active, password_hash) VALUES ('admin',1,?)").run(hash);
  const row = db.prepare(SQL).get(COMPROMISED);
  db.close();
  return Number(row.secure_admins);
}

test("production admin hash guard accepts a valid PBKDF2 credential", () => {
  assert.equal(secureCount(VALID), 1);
});

test("production admin hash guard rejects placeholders, malformed hashes, weak iterations and compromised seed", () => {
  assert.equal(secureCount("ВСТАВТЕ_ТУТ_HASH"), 0);
  assert.equal(secureCount("pbkdf2$sha256$abc$salt$key"), 0);
  assert.equal(secureCount("pbkdf2$sha256$999$AAAAAAAAAAAAAAAAAAAAAA==$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="), 0);
  assert.equal(secureCount(COMPROMISED), 0);
});
