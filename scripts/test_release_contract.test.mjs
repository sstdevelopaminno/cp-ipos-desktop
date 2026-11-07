import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFileSync(path.join(root, file), "utf8");

test("Desktop metadata has one consistent release version", () => {
  const pkg = JSON.parse(read("package.json"));
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
  const cargo = read("src-tauri/Cargo.toml");
  const appVersion = read("src/app-version.ts");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const appVersionMatch = appVersion.match(/CPIPOS_DESKTOP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(pkg.version);
  assert.equal(tauri.version, pkg.version, "Tauri and npm versions differ");
  assert.equal(cargoVersion, pkg.version, "Cargo and npm versions differ");
  assert.equal(appVersionMatch, pkg.version, "Application display version differs");
});

test("Windows updater artifacts stay enabled and application retains an explicit CSP", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(config.bundle.active, true);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.ok(config.bundle.targets.includes("nsis"));
  assert.ok(config.bundle.targets.includes("msi"));
  assert.ok(typeof config.app.security.csp === "string" && config.app.security.csp.length > 0);
  assert.ok(config.plugins.updater.pubkey, "updater public key is missing");
  assert.ok(config.plugins.updater.endpoints?.length, "updater endpoint is missing");
});

test("Company display metadata is updated without changing the signed license issuer", () => {
  const cargo = read("src-tauri/Cargo.toml");
  const issuer = read("scripts/issue-offline-license.mjs");
  assert.match(cargo, /CUTTING POINT INNOVATION CO\., LTD\./);
  assert.match(issuer, /issuer:\s*"CUTTING-POINT-TECH-IT"/);
});


test("Customer bearer license outputs are excluded from Git", () => {
  const ignore = read(".gitignore");
  for (const pattern of ["cpipos-license-*.txt", "cpipos-license-*.json", "issued-licenses/", "licenses-issued/"]) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), `Missing sensitive license ignore rule: ${pattern}`);
  }
});

test("Packaged Windows license cannot silently fall back to browser-only storage", () => {
  const gate = read("src/LicenseGate.tsx");
  const nativeGuard = 'if ("__TAURI_INTERNALS__" in window) throw new Error("LICENSE_DATABASE_UNAVAILABLE")';
  assert.ok(gate.includes(nativeGuard), "native runtime must reject browser storage fallback");
  assert.ok(gate.includes('throw new Error("LICENSE_NATIVE_STORAGE_UNAVAILABLE")'), "native trial persistence must fail closed");
  assert.ok(gate.includes('mode: "error"'), "license storage errors must not leave the POS loading forever");
});
