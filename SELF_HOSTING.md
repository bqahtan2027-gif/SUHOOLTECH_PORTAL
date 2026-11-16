# تشغيل سهول تيك على سيرفرك الخاص

المنصة لا تعتمد على Supabase أو Firebase أو قاعدة بيانات مستضافة خارجياً. الحزمة تستخدم Docker Compose وPostgreSQL محلياً وواجهة React وAPI مبني على Node.js.

## المتطلبات
- Linux server (Ubuntu 22.04/24.04 recommended)
- Docker Engine and Docker Compose plugin
- Domain name and HTTPS reverse proxy before internet exposure

## First run
1. Clone this repository onto your server.
2. Copy `.env.selfhost.example` to `.env` and replace every placeholder with long random secrets. Generate `VAULT_ENCRYPTION_KEY` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; keep a separate secure backup of this exact key.
3. Run `docker compose up -d --build`.
4. Check `http://SERVER-IP:8080/api/health`.
5. Use the one-time bootstrap API to create the first administrator:
   `POST /api/auth/bootstrap` with JSON fields `token`, `name`, `email`, `password` (12+ characters).
6. Remove BOOTSTRAP_TOKEN from the server environment and restart the API after creating the first administrator.
7. Put HTTPS in front of port 8080 before any external access.

## Important
- The database volume persists data across container restarts.
- Database ports are not published to the public host.
- Keep `.env` private and out of Git. The API container receives `VAULT_ENCRYPTION_KEY` from this file; without the same key, encrypted vault entries cannot be decrypted.
- Back up PostgreSQL regularly and test restores.
- This is an initial self-hosted MVP foundation. Before production use, complete MFA, password reset/invitation flows, audit-event coverage, granular roles, backups/restore drills, monitoring, HTTPS, and penetration/security testing.
- The bootstrap endpoint must only be used once during initial provisioning.
