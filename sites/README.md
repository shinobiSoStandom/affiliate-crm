# Affiliate CRM — Sites edition

A dependency-free private CRM for Sites, using a Cloudflare Worker and durable D1 storage. The original PingCRM fork remains in the repository root; this directory is a separate Sites-compatible implementation of the core affiliate lead workflow, not the original Python runtime.

## Implemented

- Lead cards, table and Kanban views, search and stage filters.
- Bank cards and their statuses, next action, due time and expected commission.
- Notes/history and tasks, completion and archiving.
- CSV export with spreadsheet formula escaping.
- Server-side Sites identity and ownership checks on every API data operation.
- Moscow dates and times.
- Telegram is explicitly disconnected. No Telegram sessions, messages, AI calls or external sends are simulated.

The database starts empty. No client records are seeded.

## Build and checks

No package installation is required.

```sh
node --test tests/*.test.mjs
python3 tests/schema_test.py
node scripts/build.mjs
node scripts/validate-artifact.mjs
```

Publish the exact pushed source through the Sites workflow, including the resulting deployment archive. The existing project identity is in `.openai/hosting.json`; do not create another Site. Preserve owner-private access.

Current status: source is prepared. Native runtime tests, local browser QA and production publication have not yet completed because the desktop execution environment disconnected. A reserved origin is not a published URL.

## License

AGPL-3.0. Original project: https://github.com/sneg55/pingcrm. This deployment source and its license remain available in the `sites-deployment` branch of https://github.com/shinobiSoStandom/affiliate-crm.
