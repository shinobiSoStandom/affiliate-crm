# Affiliate CRM independent validation — 2026-10-29

Source fetched through GitHub connector from `shinobiSoStandom/affiliate-crm`, `sites-deployment`, directory `sites/`.

## Passed locally
- JavaScript syntax checks: API, UI module, Worker entry point.
- Existing 11 Node tests.
- New `tests/sqlite-integration.mjs`: actual SQLite schema and real SQL queries through a D1-shaped adapter. Covers lead create/read/update/archive, bank cards, commission precision, timezone normalization, notes, task create/update, cross-owner denial, persistence after database close/reopen, and archival of linked tasks.
- Four Python SQLite schema tests.
- Dependency-free Worker build and artifact validation.

Node runtime: 24.22.1. New integration test requires a Node runtime with `node:sqlite`; this is not a Cloudflare emulator.

## Not established
- Browser smoke script was prepared but Chromium launch failed under sandbox socket restrictions. Escalated execution could not initialize its environment. Therefore no browser screenshot or frontend end-to-end pass is claimed.
- Cloudflare/D1 production runtime, deployed identity-header boundary, and real deployed persistence have not been exercised.
- No public deployment or Chrome opening was attempted.

## Existing project
- Project: `appgprj_6ae3254929308191aecc50dc05f85e69`.
- Preserve owner-private access.
- No second Sites project created.
- Telegram remains explicitly disconnected.

## Documentation discrepancy
`DEPLOYMENT.md` still describes the earlier planned Vinext port; the actual source and README now describe a dependency-free Worker. Update this document when preserving validation changes; do not interpret the old plan as an instruction to replace the implementation.

All test data is synthetic and confined to temporary SQLite storage. No production data changed.

Run the new integration test separately with Node 24+: `node --test tests/sqlite-integration.mjs`. Its filename intentionally leaves the existing default test runtime requirement unchanged.
