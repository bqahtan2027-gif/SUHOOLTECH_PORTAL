# SUHOOLTECH deployment — myWindowsHosting W500 (Shared Windows)

This is the deployment profile for the W500 shared Windows plan. It does not use Docker, root access, a VM, or a third-party database service.

## Plan capabilities and deployment prerequisites

The provider's plan information has been used as a planning reference for Node.js, PostgreSQL, IIS and resource limits. Confirm the current limits and that Node.js App is enabled in your own W500 control panel before relying on them. Keep the API lightweight and monitor memory and database usage. Provider references:
- https://www.mywindowshosting.com/hosting_plans
- https://www.mywindowshosting.com/nodejs_hosting
- https://www.mywindowshosting.com/support/kb/a2332/how-to-deploy-node_js-to-our-server-from-a-github-repository.aspx

## Target layout

- Main IIS website: compiled Vite/React static files from `dist/`.
- Node.js App: Express API from the repository's `server/` folder, exposed by the provider's Node.js application feature.
- PostgreSQL: database created in the same myWindowsHosting account (not an external SaaS).
- Browser calls API using the same-origin `/api` path where the hosting panel supports mapping/rewrite. The current frontend sends API requests to the same-origin `/api` path; a separate API hostname is not supported by this build. Do not configure one unless the frontend is first updated and tested for a configurable API base URL.

## Before deployment — provider panel values required

Create the PostgreSQL database under **Databases > PostgreSQL** and record its host, port, database name, username, password, and whether SSL is required. Do not commit these values to GitHub and do not send passwords in chat.

Create/enable the Node.js app under **Websites > Manage Website > Node.js App**. The provider documents GitHub Deploy fields for repository URL, optional GitHub token, build command, and start command. If deploying the source repository directly, configure the Node app's application root to `server` if the panel offers that setting. Use:
- Repository: `https://github.com/bqahtan2027-gif/SUHOOLTECH_PORTAL`
- Build command: `npm install --omit=dev`
- Start command: `npm start`

If the panel does not offer an application-root/working-directory setting, stop and ask hosting support how to deploy a Node app from a repository subfolder. Do not use the repository root as the API app root: its package.json is the Vite frontend package.

## Node.js environment variables

Set these in the Node.js app environment settings (never in source control):
- `DATABASE_URL`: PostgreSQL connection URI supplied/constructed from the database credentials.
- `JWT_SECRET`: random secret of at least 48 characters.
- `BOOTSTRAP_TOKEN`: one-time random token of at least 24 characters.
- `CORS_ORIGIN`: exact public frontend origin, e.g. `https://portal.example.com` (no trailing slash). If same-origin proxying is configured, still use the exact browser origin.
- `DB_SSL`: set to `true` only if the provider says the PostgreSQL endpoint requires TLS; otherwise `false`.
- `VAULT_ENCRYPTION_KEY`: a base64-encoded 32-byte random key for AES-256-GCM. Generate it once on a trusted machine with Node.js `crypto.randomBytes(32).toString('base64')`, set it only in the hosting environment settings, and never commit or send it in chat.
- `PORT`: do not hard-code; let the hosting platform assign it.

The API currently uses the `pg` driver and PostgreSQL parameter syntax. The connection pool is limited to 5 connections to be more conservative on shared hosting.

## Database initialization

Run all 22 SQL migrations in numeric order. The repository includes a PowerShell runner at `scripts/apply-migrations.ps1`:
```powershell
$env:DATABASE_URL = "postgres://USER:PASSWORD@HOST:5432/DATABASE"
.\\scripts\\apply-migrations.ps1
```
Run this from a trusted Windows machine with PostgreSQL client tools (`psql`) installed. Alternatively, execute every `database/init/*.sql` file in ascending numeric order through the provider's PostgreSQL tool. Stop immediately on the first error; do not skip a migration. CI applies all migrations twice to check repeatability. The migrations cover core access/projects, HR, documents, procurement, calendar, encrypted vault, inventory, finance, sales/purchases workflows, and ZATCA connection settings and payroll accounting lifecycle. Confirm the database user can create the `pgcrypto` extension used by migration 001. Do not expose PostgreSQL publicly.

## Release package, frontend build and IIS

After a successful push to `main`, GitHub Actions creates a downloadable artifact named `suhooltech-w500-release-<commit-sha>`. It contains `web/` (compiled frontend plus `web.config`), `api/` (Express app with production dependencies), `database/init/` (all migrations), and this hosting guide. For artifact deployment, upload the contents of `web/` to the IIS site root, set the Node.js app root to `api/`, and use `npm start` as the start command (production dependencies are already included). If deploying the source repository directly instead, use `server/` as the API app root and run `npm install --omit=dev` before `npm start`. This package is a build artifact, not a database backup and not a live deployment.

For a database backup from a trusted Windows machine with PostgreSQL client tools installed, set `DATABASE_URL` and run `scripts/backup-postgres.ps1`. Store the resulting dump outside the website and GitHub. Test restoration to a separate empty database before production use. Never share the database URI or dump publicly.

## Frontend build and IIS

Build the frontend from the repository root:
```bash
npm install
npm run build
```
For a locally built deployment, upload the contents of `dist/` plus the root `web.config` to the IIS website root (not the source tree). For the GitHub release artifact, use `web/`, which already includes `web.config`. Keep the API in the Node.js app's separate application root.

Vite build-time API base:
- Same-origin API mapping: leave `VITE_API_BASE_URL` unset and route `/api` to the Node.js app using a provider-supported IIS reverse-proxy/rewrite mapping.
- Separate API hostname: not supported by the current frontend. Keep `/api` on the same origin until a tested API-base-URL setting is implemented.

Do not assume IIS URL Rewrite can proxy to the Node app or that a custom port is public. Confirm the supported Node.js routing/binding method with myWindowsHosting support.

## First administrator and smoke test

1. Verify `https://YOUR-API-HOST/api/health` returns status `ok` and database `connected`.
2. Call `POST /api/auth/bootstrap` once with `token`, `name`, `email`, and a unique password of at least 12 characters.
3. Immediately remove `BOOTSTRAP_TOKEN` from the app settings and restart the API.
4. Test login, `/api/auth/me`, `/api/dashboard/summary`, create/list projects, update project status, create/list tasks, update task status, create/list users as admin, create a document, submit it for review, approve/reject it as a manager, archive an approved document, create a purchase request, approve/reject it as a manager, mark an approved request fulfilled, assign an asset to an employee, return/mark an asset damaged, schedule a meeting with attendees, respond to a meeting invitation, update meeting status, create and reveal encrypted vault entries, and `/api/audit-logs` as admin.
5. Confirm HTTPS works and that API errors do not expose secrets.

## W500 operational cautions

- W500 lists 256 MB application-pool memory and 1 GB PostgreSQL quota. This is a small shared-hosting footprint, not a high-traffic production server.
- No Docker Compose deployment on W500.
- Keep the pool small; avoid large uploads and heavy background jobs.
- Configure database backups from the hosting panel and test a restore. Back up `VAULT_ENCRYPTION_KEY` separately in a secure offline location; without the exact key, encrypted vault entries cannot be recovered. Never rotate or replace it without a planned decrypt-and-re-encrypt migration.
- Before real company data is used, finish MFA, password reset/invitations, granular permissions, audit coverage, monitoring, backup/restore testing, and an independent security review.
- If the provider cannot run the Express API continuously or cannot route HTTPS requests to it, this W500 plan cannot host the full app/API architecture without a provider-supported alternative.

## Provider support questions

If any setting is missing, open a ticket and ask:
1. Can W500 run a continuously listening Express app through Node.js App, and what is the required entry point/working directory?
2. How is the assigned Node.js port passed to the process, and what URL/path routes requests to that app?
3. Can IIS route `/api/*` to that Node.js app on the same site? If yes, provide the supported configuration.
4. What are the PostgreSQL host, port, database, username, and SSL requirements for Node.js apps on W500?
5. Is `pgcrypto` available to the database user for the supplied initialization script?
