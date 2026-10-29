# Affiliate CRM — Sites deployment

Status: registered, not built or published. No Telegram account is connected.

- Site project ID: `appgprj_6ae3254929308191aecc50dc05f85e69`
- Reserved origin (not evidence of deployment): `https://affiliate-crm.shinobi-so-standom.chatgpt.site`
- Audience: owner-private; preserve it.
- Upstream: `sneg55/pingcrm`, snapshot `9c533361cf57a77532777b8312a2c085019dd313`, AGPL-3.0.

## Runtime boundary

The original backend requires Python/FastAPI, PostgreSQL, Redis and Celery. Sites hosts Cloudflare Workers, so the existing Docker stack cannot be deployed there unchanged. No external backend or private HTTP tunnel has been provisioned.

## Prepared implementation direction

Keep the PingCRM frontend and port core CRM API operations to Sites Worker routes backed by D1. Use Sites identity instead of the original JWT login. Preserve the upstream license and attribution.

1. Open the existing registered Site with Sites source credentials; do not register a second Site.
2. Initialize the supported Vinext starter in this directory, retaining `.openai/hosting.json` and the starter's `sites()` integration.
3. Port the upstream frontend and preserve its UI and response envelopes.
4. Implement contacts, notes/history, tags, search and reminders with durable D1 storage and server-side owner checks.
5. Show Telegram/AI integrations as disconnected until a supported integration backend exists; do not simulate successful connection or synchronization.
6. Build, verify CRUD and persistence, push the exact source and publish the existing Site privately.
7. Verify the returned production URL, then open it in Google Chrome.

## Current blocker

The desktop execution environment and Chrome control disconnected before local files, dependency installation, build or publication could run. Site registration is retained here so the same deployment can resume when that environment becomes available. No credentials or private data are stored in this branch.
