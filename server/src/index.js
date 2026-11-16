import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;
const required = ["DATABASE_URL", "JWT_SECRET"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
if (process.env.JWT_SECRET.length < 48) throw new Error("JWT_SECRET must contain at least 48 characters");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 15, ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false });
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:8080").split(","), credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));

const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
const bootstrapSchema = z.object({ token: z.string().min(24), name: z.string().min(2).max(120), email: z.string().email().max(254), password: z.string().min(12).max(128) });
function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "8h", issuer: "suhooltech", audience: "suhooltech-portal" });
}
function auth(req, res, next) {
  try {
    const value = req.headers.authorization || "";
    if (!value.startsWith("Bearer ")) return res.status(401).json({ error: "يلزم تسجيل الدخول" });
    req.user = jwt.verify(value.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"], issuer: "suhooltech", audience: "suhooltech-portal" });
    pool.query("select 1 from users where id=$1 and active=true", [req.user.sub]).then(result => {
      if (!result.rowCount) return res.status(401).json({ error: "الحساب غير نشط" });
      next();
    }).catch(() => res.status(503).json({ error: "تعذر التحقق من الحساب" }));
  } catch { return res.status(401).json({ error: "انتهت الجلسة أو أن بيانات الدخول غير صالحة" }); }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "ليس لديك صلاحية لهذه العملية" });
  next();
}
app.get("/api/health", async (_req, res) => {
  try { await pool.query("select 1"); res.json({ status: "ok", database: "connected" }); }
  catch { res.status(503).json({ status: "degraded", database: "unavailable" }); }
});
app.post("/api/auth/bootstrap", async (req, res) => {
  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "تحقق من الاسم والبريد وكلمة المرور (12 خانة على الأقل)" });
  if (!process.env.BOOTSTRAP_TOKEN || parsed.data.token !== process.env.BOOTSTRAP_TOKEN) return res.status(403).json({ error: "رمز التهيئة غير صحيح" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(734921055)");
    const count = await client.query("select count(*)::int as n from users");
    if (count.rows[0].n !== 0) { await client.query("rollback"); return res.status(409).json({ error: "تم إنشاء المدير الأول مسبقاً" }); }
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const created = await client.query("insert into users(full_name,email,password_hash,role) values($1,lower($2),$3,'admin') returning id,full_name,email,role", [parsed.data.name, parsed.data.email, hash]);
    await client.query("commit");
    const user = created.rows[0];
    res.status(201).json({ token: issueToken(user), user });
  } catch (e) { await client.query("rollback"); console.error("bootstrap failed", e.message); res.status(500).json({ error: "تعذر إنشاء المدير" }); }
  finally { client.release(); }
});
app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات الدخول غير مكتملة" });
  try {
    const result = await pool.query("select id,full_name,email,role,password_hash,active from users where email=lower($1)", [parsed.data.email]);
    const user = result.rows[0];
    if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: "البريد أو كلمة المرور غير صحيحة" });
    await pool.query("update users set last_login_at=now() where id=$1", [user.id]);
    const safe = { id: user.id, full_name: user.full_name, email: user.email, role: user.role };
    res.json({ token: issueToken(safe), user: safe });
  } catch { res.status(500).json({ error: "تعذر تسجيل الدخول" }); }
});
app.get("/api/auth/me", auth, async (req, res) => {
  const r = await pool.query("select id,full_name,email,role,active,created_at from users where id=$1", [req.user.sub]);
  if (!r.rows[0]?.active) return res.status(401).json({ error: "الحساب غير نشط" });
  res.json({ user: r.rows[0] });
});
app.get("/api/users", auth, admin, async (_req, res) => {
  const r = await pool.query("select id,full_name,email,role,active,last_login_at,created_at from users order by created_at desc");
  res.json({ users: r.rows });
});
app.post("/api/users", auth, admin, async (req, res) => {
  const schema = z.object({ name: z.string().min(2).max(120), email: z.string().email(), password: z.string().min(12).max(128), role: z.enum(["admin","manager","employee"]).default("employee") });
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "تحقق من بيانات المستخدم وكلمة المرور" });
  try {
    const hash = await bcrypt.hash(p.data.password, 12);
    const r = await pool.query("insert into users(full_name,email,password_hash,role) values($1,lower($2),$3,$4) returning id,full_name,email,role,active,created_at", [p.data.name,p.data.email,hash,p.data.role]);
    res.status(201).json({ user: r.rows[0] });
  } catch (e) { res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "البريد مسجل مسبقاً" : "تعذر إنشاء المستخدم" }); }
});
app.get("/api/tasks", auth, async (_req, res) => {
  const r = await pool.query("select id,title,description,status,priority,due_date,created_at from tasks order by created_at desc limit 200");
  res.json({ tasks: r.rows });
});
app.post("/api/tasks", auth, async (req, res) => {
  const schema = z.object({ title: z.string().min(2).max(180), description: z.string().max(4000).optional(), priority: z.enum(["low","normal","high","urgent"]).default("normal"), due_date: z.string().date().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "عنوان المهمة غير صالح" });
  const r = await pool.query("insert into tasks(title,description,priority,due_date,created_by) values($1,$2,$3,$4,$5) returning *", [p.data.title,p.data.description || null,p.data.priority,p.data.due_date || null,req.user.sub]);
  res.status(201).json({ task: r.rows[0] });
});
app.patch("/api/tasks/:id/status", auth, async (req, res) => {
  const p = z.object({ status: z.enum(["todo","in_progress","review","done","blocked"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "حالة المهمة غير صالحة" });
  const r = await pool.query("update tasks set status=$1,updated_at=now() where id=$2 returning *", [p.data.status,req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "المهمة غير موجودة" });
  res.json({ task: r.rows[0] });
});
app.use((err, _req, res, _next) => { console.error("request error", err.message); res.status(500).json({ error: "حدث خطأ داخلي" }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => console.log(`Suhool Tech API listening on ${port}`));
