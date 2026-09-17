#!/usr/bin/env node
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const command = args.shift();

const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
};

const required = (name) => {
  const value = option(name).trim();
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};

const ensureParent = (path) => mkdirSync(dirname(resolve(path)), { recursive: true });
const base64url = (value) => Buffer.from(value).toString("base64url");

const initAuthority = () => {
  const privatePath = option("private", "secrets/license-it/license-private.pem");
  const publicPath = option("public", "src-tauri/license_public_key.b64");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const rawPublicKey = Buffer.from(publicDer).subarray(-32);

  ensureParent(privatePath);
  ensureParent(publicPath);
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  writeFileSync(publicPath, `${rawPublicKey.toString("base64")}\n`, "utf8");

  console.log(`Private key: ${resolve(privatePath)}`);
  console.log(`Public key:  ${resolve(publicPath)}`);
  console.log("IMPORTANT: keep the private key outside Git, backups, customer PCs, and installers.");
  console.log("Rebuild CpIPOS Desktop after changing the public key.");
};

const parseExpiry = (value) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "never" || normalized === "lifetime") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid --expires value: ${value}`);
  return Math.floor(milliseconds / 1000);
};

const issueLicense = () => {
  const privatePath = option("private", "secrets/license-it/license-private.pem");
  const licenseId = required("license-id");
  const customer = required("customer");
  const devices = required("devices")
    .split(/[;,]/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const deviceLimit = Number(option("device-limit", String(devices.length)));
  const expiresAt = parseExpiry(option("expires", "lifetime"));
  const outPath = option("out", "").trim();

  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) throw new Error("--device-limit must be an integer >= 1");
  if (!devices.length) throw new Error("At least one device fingerprint is required");
  if (devices.length > deviceLimit) throw new Error("Number of --devices exceeds --device-limit");
  if (new Set(devices).size !== devices.length) throw new Error("Duplicate device fingerprint in --devices");

  const privateKey = createPrivateKey(readFileSync(privatePath, "utf8"));
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    product: "cpipos-desktop",
    licenseId,
    customer,
    issuedAt,
    expiresAt,
    deviceLimit,
    devices,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const signedMessage = `CPIPOS1.${payloadB64}`;
  const signatureB64 = sign(null, Buffer.from(signedMessage, "utf8"), privateKey).toString("base64url");
  const licenseCode = `${signedMessage}.${signatureB64}`;

  if (outPath) {
    ensureParent(outPath);
    writeFileSync(outPath, `${licenseCode}\n`, "utf8");
    console.log(`License written: ${resolve(outPath)}`);
  } else {
    console.log(licenseCode);
  }

  console.error(`License ID: ${licenseId}`);
  console.error(`Customer: ${customer}`);
  console.error(`Devices: ${devices.length}/${deviceLimit}`);
  console.error(`Expires: ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "lifetime"}`);
};

const printHelp = () => {
  console.log(`CpIPOS Offline License IT Tool

Generate the company Ed25519 authority key pair once:
  node scripts/license-it-tool.mjs init

Issue a 1-device lifetime license:
  node scripts/license-it-tool.mjs issue \\
    --license-id CPT-2026-0001 \\
    --customer "Example Shop" \\
    --devices CPD-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD \\
    --device-limit 1 \\
    --expires lifetime \\
    --out secrets/license-it/CPT-2026-0001.cpipos

Issue a 2-device license:
  node scripts/license-it-tool.mjs issue \\
    --license-id CPT-2026-0002 \\
    --customer "Example Branches" \\
    --devices CPD-AAA...,CPD-BBB... \\
    --device-limit 2 \\
    --expires 2027-12-31T23:59:59+07:00
`);
};

try {
  if (command === "init") initAuthority();
  else if (command === "issue") issueLicense();
  else printHelp();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
