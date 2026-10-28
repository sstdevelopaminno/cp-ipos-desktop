import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(repoRoot, "scripts", "issue-offline-license.mjs");

test("offline license issuer signs tokens and never logs or overwrites them", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cpipos-license-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keyPath = path.join(dir, "test-private-key.pem");
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  const output = path.join(dir, "customer.license");
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CPIPOS_LICENSE_PRIVATE_KEY: keyPath },
  });
  const normal = run(
    "--license-id", "CP-20261028-A1B2C3D4",
    "--device", "CP-AAAAA-BBBBB-CCCCC-DDDDD",
    "--customer", "QA Store",
    "--out", output,
  );
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(existsSync(output), true);
  const jsonPath = path.join(dir, "customer.json");
  assert.equal(existsSync(jsonPath), true);
  const token = readFileSync(output, "utf8").trim();
  assert.equal(token.startsWith("CP1."), true);
  assert.equal(normal.stdout.includes(token), false, "license must not leak in logs");
  assert.equal(normal.stderr.includes(token), false);
  const [prefix, payloadPart, signaturePart] = token.split(".");
  assert.equal(prefix, "CP1");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.equal(payload.issuer, "CUTTING-POINT-TECH-IT", "retain signed legacy issuer for existing IT compatibility");
  assert.equal(payload.devices.length, 1);
  assert.equal(verify("sha256", Buffer.from(payloadPart), {
    key: publicKey,
    dsaEncoding: "ieee-p1363",
  }, Buffer.from(signaturePart, "base64url")), true);
  const metadata = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(metadata.token, token);
  assert.notEqual(readFileSync(output, "utf8").trimStart()[0], "{");

  const badOutput = run(
    "--license-id", "CP-20261028-A1B2C3D4",
    "--device", "CP-AAAAA-BBBBB-CCCCC-DDDDD",
    "--out", path.join(dir, "would-overwrite.json"),
  );
  assert.notEqual(badOutput.status, 0);
  assert.equal(existsSync(path.join(dir, "would-overwrite.json")), false);

  const badDate = run(
    "--license-id", "CP-20261028-A1B2C3D4",
    "--device", "CP-AAAAA-BBBBB-CCCCC-DDDDD",
    "--not-before", "not-a-date",
  );
  assert.notEqual(badDate.status, 0);

  const invalidExpiry = run(
    "--license-id", "CP-20261028-A1B2C3D4",
    "--device", "CP-AAAAA-BBBBB-CCCCC-DDDDD",
    "--not-before", "2026-10-28T00:00:00Z",
    "--expires", "2026-10-27T00:00:00Z",
  );
  assert.notEqual(invalidExpiry.status, 0);
});
