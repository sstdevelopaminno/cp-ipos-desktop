import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts", "assert-production-acceptance.mjs");
const run = (tag, channel) => spawnSync(process.execPath, [script], {
  encoding: "utf8",
  env: {...process.env, CPIPOS_RELEASE_TAG:tag, CPIPOS_RELEASE_CHANNEL:channel}
});
test("customer stable release is blocked without genuine acceptance records", t => {
  const tag="v99.99.99";
  const dir=path.join(root, "docs", "acceptance");
  const file=path.join(dir, tag+".json");
  assert.equal(existsSync(file), false, "test version must not be preapproved");
  const blocked=run(tag,"stable");
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/PRODUCTION_ACCEPTANCE_EVIDENCE_MISSING/);
  const candidate=run(tag,"customer-test");
  assert.equal(candidate.status,0,candidate.stderr);
  mkdirSync(dir,{recursive:true});
  const template=JSON.parse(readFileSync(path.join(dir,"TEMPLATE.json"),"utf8"));
  const denied={...template,release:tag,approved:true,approvedBy:"Test QA",approvedAt:new Date().toISOString()};
  writeFileSync(file,JSON.stringify(denied));
  t.after(()=>rmSync(file,{force:true}));
  const stillDenied=run(tag,"stable");
  assert.notEqual(stillDenied.status,0,"approved flag alone must not bypass UAT checks");
  assert.match(stillDenied.stderr,/PRODUCTION_CHECK_NOT_EVIDENCED/);
});
