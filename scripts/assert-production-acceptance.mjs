#!/usr/bin/env node
// Only an evidence-backed, explicitly approved customer release is publishable.
// This validates the presence of evidence; it cannot replace human hardware UAT.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tag = process.env.CPIPOS_RELEASE_TAG || process.argv[2] || "";
const channel = process.env.CPIPOS_RELEASE_CHANNEL || process.argv[3] || "stable";
if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) throw new Error("RELEASE_TAG_INVALID");
if (channel !== "stable") {
  console.log("Non-stable candidate: customer production acceptance is not asserted");
  process.exit(0);
}

const file = path.join(root, "docs", "acceptance", tag + ".json");
if (!fs.existsSync(file)) throw new Error("PRODUCTION_ACCEPTANCE_EVIDENCE_MISSING: " + tag);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const tests = [
  "cleanWindowsInstall",
  "offlineSaleAndShift",
  "sqliteBackupRestore",
  "printer58mmThai",
  "printer80mmThai",
  "barcodeScannerAndCashDrawer",
  "licenseDeviceAndExpiry",
  "updaterAndRollback",
  "authenticodeSigning",
  "websiteDownload"
];
if (doc.release !== tag || doc.approved !== true || typeof doc.approvedBy !== "string" || !doc.approvedBy.trim() ||
  !Number.isFinite(Date.parse(doc.approvedAt))) throw new Error("PRODUCTION_APPROVAL_INCOMPLETE");
for (const key of tests) {
  const record = doc.checks?.[key];
  if (!record || record.status !== "passed" ||
    !/^https:\/\/[^\s]+$/.test(String(record.evidence || ""))) {
    throw new Error("PRODUCTION_CHECK_NOT_EVIDENCED: " + key);
  }
}
console.log("Customer production acceptance records present for " + tag + " (verification of linked evidence requires reviewer)");
