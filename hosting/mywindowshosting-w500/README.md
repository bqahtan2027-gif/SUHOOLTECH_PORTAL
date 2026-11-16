# SUHOOLTECH deployment — myWindowsHosting W500 (Shared Windows)

This is the deployment profile for the W500 shared Windows plan. It does not use Docker, root access, a VM, or a third-party database service.

## Verified plan limits / features

The provider's current plan comparison lists W500 with Node.js, PostgreSQL (1 GB), one IIS site, and a 256 MB dedicated application pool. Keep the API lightweight and monitor memory and database usage. Provider references:
- https://www.mywindowshosting.com/hosting_plans
- https://www.mywindowshosting.com/nodejs_hosting
- https://www.mywindowshosting.com/support/kb/a2332/how-to-deploy-node_js-to-our-server-from-a-github-repository.aspx

## Target layout

- Main IIS website: compiled Vite/React static files from `dist/`.
- Node.js App: Express API from the repository's `server/` folder, exposed by the provider's Node.js application feature.
- PostgreSQL: database created in the same myWindowsHosting account (not an external SaaS).
- Browser calls API using the same-origin `/api` path where the hosting panel supports mapping/rewrite. If the provider assigns a separate API hostname, set `VITE_API_BASE_URL` at build time and set `CORS_ORIGIN` to the exact website origin.

## Before deployment — provider panel values required

Create the PostgreSQL database under **Databases > PostgreSQL** and record its host, port, database name, username, password, and whether SSL is required. Do not commit these values to GitHub and do not send passwords in chat.

Create/enable the Node.js app under **Websites > Manage Website > Node.js App**. The provider documents GitHub Deploy fields for repository URL, optional GitHub token, build command, and start command. Configure the Node app's application root to `server` if the panel offers that setting. Use:
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
- `PORT`: do not hard-code; let the hosting platform assign it.

The API currently uses the `pg` driver and PostgreSQL parameter syntax. The connection pool is limited to 5 connections to be more conservative on shared hosting.

## Database initialization

Run `database/init/001_core.sql` against the newly created PostgreSQL database using the provider's database tool or an approved PostgreSQL client. Confirm the account has permission to create the `pgcrypto` extension; if not, ask support to enable it or provide an approved alternative before proceeding. Do not expose PostgreSQL publicly.

## Frontend build and IIS

Build the frontend from the repository root:
```bash
npm ci
npm run build
```
Upload the contents of `dist/` to the IIS website root (not the source tree). Include the repository's root `web.config` to enable client-side route fallback. Keep the API in the Node.js app's separate application root.

Vite build-time API base:
- Same-origin API mapping: leave `VITE_API_BASE_URL` unset and route `/api` to the Node.js app using a provider-supported IIS reverse-proxy/rewrite mapping.
- Separate API hostname: set `VITE_API_BASE_URL=https://api.example.com` before `npm run build`; configure `CORS_ORIGIN` on the API to the exact frontend origin.

Do not assume IIS URL Rewrite can proxy to the Node app or that a custom port is public. Confirm the supported Node.js routing/binding method with myWindowsHosting support.

## First administrator and smoke test

1. Verify `https://YOUR-API-HOST/api/health` returns status `ok` and database `connected`.
2. Call `POST /api/auth/bootstrap` once with `token`, `name`, `email`, and a unique password of at least 12 characters.
3. Immediately remove `BOOTSTRAP_TOKEN` from the app settings and restart the API.
4. Test login, `/api/auth/me`, create/list tasks, and create/list users as admin.
5. Confirm HTTPS works and that API errors do not expose secrets.

## W500 operational cautions

- W500 lists 256 MB application-pool memory and 1 GB PostgreSQL quota. This is a small shared-hosting footprint, not a high-traffic production server.
- No Docker Compose deployment on W500.
- Keep the pool small; avoid large uploads and heavy background jobs.
- Configure database backups from the hosting panel and test a restore.
- Before real company data is used, finish MFA, password reset/invitations, granular permissions, audit coverage, monitoring, backup/restore testing, and an independent security review.
- If the provider cannot run the Express API continuously or cannot route HTTPS requests to it, this W500 plan cannot host the full app/API architecture without a provider-supported alternative.

## Provider support questions

If any setting is missing, open a ticket and ask:
1. Can W500 run a continuously listening Express app through Node.js App, and what is the required entry point/working directory?
2. How is the assigned Node.js port passed to the process, and what URL/path routes requests to that app?
3. Can IIS route `/api/*` to that Node.js app on the same site? If yes, provide the supported configuration.
4. What are the PostgreSQL host, port, database, username, and SSL requirements for Node.js apps on W500?
5. Is `pgcrypto` available to the database user for the supplied initialization script?
