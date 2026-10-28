# Desktop main branch reconciliation — 2026-10-28

## Objective
Make the default `main` branch reflect the currently developed and released CpIPOS Desktop architecture without losing the independently developed alternate main UI/prototype. Do **not** publish any new Windows customer release from this integration by itself.

## Source commits and source of truth
- Historical default main: `c26459dfa160fd7013e292c9a6aab0f9ade5d678` (older prototype).
- Current dev source: `ff2fb62f692eef09d3379b6a9f731c907c24116b` (includes PR #4 safety checks, release metadata and CI tests).
- Published v0.3.4 artifact source: `publish/v0.3.4` at `662d0df2b807e147f2a5b7c082702161d4fc4c3e` (must remain unchanged).
- Integration uses an explicit two-parent reconciliation commit, thereby preserving both commit ancestries. It makes the `dev/ui-system` tree the active application code and retains the older main-only prototype variants in the archive below.

## Conflict policy
The old `main` prototype UI is **not silently discarded**, nor is it accidentally reenabled in the customer runtime. Seventeen original files, including the alternate entry point, license gate, sales workspace, app shell and older workflows, are stored byte-for-byte as Git blobs under:

`archive/main-ui-prototype-20260918/`

This archive is **reference code only**. The active application stays on the current `src/main.tsx` + `src/LicenseGate.tsx` + Tauri 2 architecture, and the present signed ECDSA P-256 license authority remains authoritative. The older main prototype must never be copied back over the live runtime without an explicit design review and license migration test.

Main-only original commits remain in full Git history (second parent of the reconciliation commit). Archive files use a folder outside `src/` to avoid accidental application inclusion or typechecking.

## CI / merge checks
- [ ] Integration PR CI passes frontend compilation, signed-license issuer test, release metadata consistency, SQLite migrations smoke test, and Rust check.
- [ ] A fresh development Windows installer build passes on the exact merged commit (and is **not** automatically published to the public Releases page).
- [ ] No negative change to existing `v0.3.4` signed license activation; preserve historical issuer `CUTTING-POINT-TECH-IT` unless a separately reviewed versioned migration is deployed.
- [ ] Review change list for security/functional regressions; do not merge blindly if any check is red.
- [ ] Review hardware checklist in `docs/RELEASE_READINESS_2026-10-28.md` before calling the Desktop product production-ready.

## After successful integration
- Merge this integration PR into `main` once CI and review pass.
- Close obsolete PR #3 as superseded only **after** confirming main contains both ancestors and the current Desktop baseline.
- Evaluate older PR #2 native Ed25519 branch separately as an incompatible crypto-model proposal, not as an unreviewed direct merge.
- Keep the public customer release and downloads unchanged until hands-on Windows QA is accepted.

## Branding
Use **CUTTING POINT INNOVATION CO., LTD.** for visible company metadata. The historical signed license issuer is a protocol constant rather than a brand label and must remain stable for old tokens.
