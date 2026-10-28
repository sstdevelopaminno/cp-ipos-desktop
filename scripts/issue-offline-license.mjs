#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const values = new Map();
const devices = [];
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (key === "--device") { devices.push(args[++i]); continue; }
  if (key.startsWith("--")) values.set(key, args[++i]);
}

const required = name => {
  const value = values.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const privateKeyPath = process.env.CPIPOS_LICENSE_PRIVATE_KEY || values.get("--private-key");
if (!privateKeyPath) throw new Error("Set CPIPOS_LICENSE_PRIVATE_KEY or pass --private-key <path>");
if (devices.length < 1 || devices.length > 2) throw new Error("Offline CpIPOS licenses support exactly 1 or 2 --device values");
const normalizedDevices = [...new Set(devices.map(v => v.trim().toUpperCase()))];
if (normalizedDevices.length !== devices.length) throw new Error("Duplicate device code");
if (normalizedDevices.some(v => !/^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/.test(v))) throw new Error("Invalid device code format");

const issuedAt = new Date().toISOString();
const notBefore = values.get("--not-before") || issuedAt;
if (!Number.isFinite(Date.parse(notBefore))) throw new Error("Invalid --not-before date");
const expires = values.get("--expires") || null;
if (expires && !Number.isFinite(Date.parse(expires))) throw new Error("Invalid --expires date");
if (expires && Date.parse(expires) <= Date.parse(notBefore)) throw new Error("--expires must be after --not-before");
const payload = {
  v: 1,
  product: "CPIPOS-DESKTOP",
  issuer: "CUTTING-POINT-TECH-IT",
  licenseId: required("--license-id"),
  customer: values.get("--customer") || "",
  plan: values.get("--plan") || "Offline Standard",
  issuedAt,
  notBefore,
  expiresAt: expires,
  maxDevices: normalizedDevices.length,
  devices: normalizedDevices,
  features: (values.get("--features") || "offline-pos").split(",").map(v => v.trim()).filter(Boolean),
};

const b64url = input => Buffer.from(input).toString("base64url");
const payloadPart = b64url(JSON.stringify(payload));
const privateKey = fs.readFileSync(privateKeyPath, "utf8");
const signature = crypto.sign("sha256", Buffer.from(payloadPart, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" });
const token = `CP1.${payloadPart}.${signature.toString("base64url")}`;
const output = values.get("--out") || `cpipos-license-${payload.licenseId}.txt`;
const parsedOutput = path.parse(output);
const metadataOutput = path.join(parsedOutput.dir, `${parsedOutput.name}.json`);
if (path.resolve(metadataOutput) === path.resolve(output)) {
  throw new Error("--out must not end with .json (reserved for license metadata)");
}
fs.writeFileSync(output, token + "\n", { mode: 0o600 });
fs.writeFileSync(metadataOutput, JSON.stringify({ ...payload, token }, null, 2), { mode: 0o600 });
console.log(`Issued ${payload.licenseId} for ${normalizedDevices.length} device(s)`);
console.log(`License file: ${output}`);
console.log(`Metadata file: ${metadataOutput}`);
// Do not print the bearer license token into CI/terminal logs.
