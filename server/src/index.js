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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false });
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
    pool.query("select role,active from users where id=$1", [req.user.sub]).then(result => {
      if (!result.rowCount || !result.rows[0].active) return res.status(401).json({ error: "الحساب غير نشط" });
      req.user.role = result.rows[0].role;
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
app.post("/api/auth/bootstrap", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
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
    await audit(user.id, "user.bootstrap", "user", user.id, { email: user.email });
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
    await audit(user.id, "auth.login", "user", user.id);
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
    await audit(req.user.sub, "user.created", "user", r.rows[0].id, { email: r.rows[0].email, role: r.rows[0].role });
    res.status(201).json({ user: r.rows[0] });
  } catch (e) { res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "البريد مسجل مسبقاً" : "تعذر إنشاء المستخدم" }); }
});

const quoteItemSchema = z.object({
  description: z.string().trim().min(2).max(500),
  quantity: z.number().positive().max(1000000),
  unit_price: z.number().min(0).max(100000000)
});
const quoteSchema = z.object({
  client_name: z.string().trim().min(2).max(180),
  client_email: z.string().email().max(254).optional().or(z.literal("")),
  client_phone: z.string().max(40).optional(),
  valid_until: z.string().date().optional(),
  discount_amount: z.number().min(0).max(100000000).default(0),
  notes: z.string().max(4000).optional(),
  items: z.array(quoteItemSchema).min(1).max(100)
});
const quoteWriter = (req, res, next) => {
  if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ error: "إنشاء وتعديل عروض الأسعار متاح للمدير ومدير النظام" });
  next();
};
app.get("/api/quotes", auth, async (_req, res) => {
  try {
    const r = await pool.query(`
      select q.id,q.quote_number,q.client_name,q.client_email,q.client_phone,q.status,
        q.subtotal,q.discount_amount,q.tax_rate,q.tax_amount,q.total,q.valid_until,q.notes,q.created_at,
        coalesce(json_agg(json_build_object('id',i.id,'description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.id)
          filter (where i.id is not null),'[]'::json) as items
      from quotes q left join quote_items i on i.quote_id=q.id
      group by q.id order by q.created_at desc limit 200
    `);
    res.json({ quotes: r.rows });
  } catch (error) {
    console.error("quotes list failed", error.message);
    res.status(503).json({ error: "تعذر تحميل عروض الأسعار. تحقق من تطبيق تحديث قاعدة البيانات." });
  }
});
app.post("/api/quotes", auth, quoteWriter, async (req, res) => {
  const p = quoteSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "تحقق من بيانات العميل وبنود العرض والأسعار" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const items = p.data.items.map(item => ({ ...item, line_total: Math.round(item.quantity * item.unit_price * 100) / 100 }));
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;
    if (p.data.discount_amount > subtotal) { await client.query("rollback"); return res.status(400).json({ error: "الخصم لا يمكن أن يتجاوز المجموع قبل الضريبة" }); }
    const discount = Math.round(p.data.discount_amount * 100) / 100;
    const taxable = Math.round((subtotal - discount) * 100) / 100;
    const taxRate = 15;
    const tax = Math.round(taxable * taxRate) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;
    const numberResult = await client.query("select nextval('quote_number_seq') as n");
    const quoteNumber = `QT-${new Date().getFullYear()}-${String(numberResult.rows[0].n).padStart(6, "0")}`;
    const created = await client.query(
      "insert into quotes(quote_number,client_name,client_email,client_phone,subtotal,discount_amount,tax_rate,tax_amount,total,valid_until,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *",
      [quoteNumber,p.data.client_name,p.data.client_email || null,p.data.client_phone || null,subtotal,discount,taxRate,tax,p.data.valid_until || null,p.data.notes || null,req.user.sub]
    );
    for (const item of items) {
      await client.query("insert into quote_items(quote_id,description,quantity,unit_price,line_total) values($1,$2,$3,$4,$5)",
        [created.rows[0].id,item.description,item.quantity,item.unit_price,item.line_total]);
    }
    await client.query("commit");
    await audit(req.user.sub, "quote.created", "quote", created.rows[0].id, { quote_number: quoteNumber, total });
    res.status(201).json({ quote: { ...created.rows[0], items } });
  } catch (error) {
    await client.query("rollback");
    console.error("quote create failed", error.message);
    res.status(500).json({ error: "تعذر إنشاء عرض السعر" });
  } finally { client.release(); }
});
app.patch("/api/quotes/:id/status", auth, quoteWriter, async (req, res) => {
  const p = z.object({ status: z.enum(["draft","sent","approved","rejected","expired"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "حالة العرض غير صالحة" });
  try {
    const r = await pool.query("update quotes set status=$1,updated_at=now() where id=$2 returning id,quote_number,status", [p.data.status,req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "عرض السعر غير موجود" });
    await audit(req.user.sub, "quote.status_changed", "quote", req.params.id, { status: p.data.status });
    res.json({ quote: r.rows[0] });
  } catch (error) {
    console.error("quote status update failed", error.message);
    res.status(500).json({ error: "تعذر تحديث حالة العرض" });
  }
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
  await audit(req.user.sub, "task.created", "task", r.rows[0].id, { title: r.rows[0].title });
  res.status(201).json({ task: r.rows[0] });
});
app.patch("/api/tasks/:id/status", auth, async (req, res) => {
  const p = z.object({ status: z.enum(["todo","in_progress","review","done","blocked"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "حالة المهمة غير صالحة" });
  const r = await pool.query("update tasks set status=$1,updated_at=now() where id=$2 returning *", [p.data.status,req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: "المهمة غير موجودة" });
  await audit(req.user.sub, "task.status_changed", "task", req.params.id, { status: p.data.status });
  res.json({ task: r.rows[0] });
});

async function audit(actorId, action, entityType, entityId, metadata = {}) {
  try {
    await pool.query(
      "insert into audit_logs(actor_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,$5)",
      [actorId || null, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error("audit log write failed", error.message);
  }
}

app.get("/api/dashboard/summary", auth, async (_req, res) => {
  try {
    const [projects, tasks, users] = await Promise.all([
      pool.query("select count(*)::int as total, count(*) filter (where status='active')::int as active, count(*) filter (where status='completed')::int as completed from projects"),
      pool.query("select count(*)::int as total, count(*) filter (where status='done')::int as completed, count(*) filter (where status in ('todo','in_progress','review','blocked'))::int as open, count(*) filter (where due_date < current_date and status <> 'done')::int as overdue from tasks"),
      pool.query("select count(*)::int as total, count(*) filter (where active=true)::int as active from users")
    ]);
    res.json({ projects: projects.rows[0], tasks: tasks.rows[0], users: users.rows[0] });
  } catch (error) {
    console.error("dashboard summary failed", error.message);
    res.status(503).json({ error: "تعذر تحميل مؤشرات لوحة التحكم. تحقق من تطبيق تحديث قاعدة البيانات." });
  }
});

app.get("/api/projects", auth, async (_req, res) => {
  try {
    const r = await pool.query(
      "select p.id,p.name,p.description,p.status,p.start_date,p.due_date,p.created_at,p.updated_at,u.full_name as owner_name from projects p left join users u on u.id=p.owner_id order by p.created_at desc limit 200"
    );
    res.json({ projects: r.rows });
  } catch (error) {
    console.error("projects list failed", error.message);
    res.status(503).json({ error: "تعذر تحميل المشاريع. قد تحتاج إلى تطبيق تحديث قاعدة البيانات." });
  }
});

app.post("/api/projects", auth, async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(180),
    description: z.string().max(4000).optional(),
    start_date: z.string().date().optional(),
    due_date: z.string().date().optional()
  });
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "تحقق من اسم المشروع والتواريخ" });
  try {
    const r = await pool.query(
      "insert into projects(name,description,start_date,due_date,owner_id) values($1,$2,$3,$4,$5) returning *",
      [p.data.name,p.data.description || null,p.data.start_date || null,p.data.due_date || null,req.user.sub]
    );
    await audit(req.user.sub, "project.created", "project", r.rows[0].id, { name: r.rows[0].name });
    res.status(201).json({ project: r.rows[0] });
  } catch (error) {
    console.error("project create failed", error.message);
    res.status(500).json({ error: "تعذر إنشاء المشروع" });
  }
});

app.patch("/api/projects/:id/status", auth, async (req, res) => {
  const p = z.object({ status: z.enum(["active","on_hold","completed","cancelled"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "حالة المشروع غير صالحة" });
  try {
    const r = await pool.query("update projects set status=$1,updated_at=now() where id=$2 returning *", [p.data.status,req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "المشروع غير موجود" });
    await audit(req.user.sub, "project.status_changed", "project", req.params.id, { status: p.data.status });
    res.json({ project: r.rows[0] });
  } catch (error) {
    console.error("project status update failed", error.message);
    res.status(500).json({ error: "تعذر تحديث المشروع" });
  }
});

app.patch("/api/users/:id", auth, admin, async (req, res) => {
  const schema = z.object({
    role: z.enum(["admin","manager","employee"]).optional(),
    active: z.boolean().optional()
  }).refine(value => value.role !== undefined || value.active !== undefined);
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "حدد الصلاحية أو حالة الحساب بشكل صحيح" });
  if (req.params.id === req.user.sub && p.data.active === false) return res.status(400).json({ error: "لا يمكنك إيقاف حسابك الحالي" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select id,role,active from users where id=$1 for update", [req.params.id]);
    if (!current.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "المستخدم غير موجود" }); }
    const nextRole = p.data.role ?? current.rows[0].role;
    const nextActive = p.data.active ?? current.rows[0].active;
    if (current.rows[0].role === "admin" && current.rows[0].active && (nextRole !== "admin" || !nextActive)) {
      const admins = await client.query("select count(*)::int as n from users where role='admin' and active=true");
      if (admins.rows[0].n <= 1) { await client.query("rollback"); return res.status(409).json({ error: "لا يمكن تعطيل أو تخفيض صلاحية آخر مدير نشط" }); }
    }
    const updated = await client.query(
      "update users set role=$1,active=$2 where id=$3 returning id,full_name,email,role,active,last_login_at,created_at",
      [nextRole,nextActive,req.params.id]
    );
    await client.query("commit");
    await audit(req.user.sub, "user.updated", "user", req.params.id, { role: nextRole, active: nextActive });
    res.json({ user: updated.rows[0] });
  } catch (error) {
    await client.query("rollback");
    console.error("user update failed", error.message);
    res.status(500).json({ error: "تعذر تحديث المستخدم" });
  } finally { client.release(); }
});

app.get("/api/audit-logs", auth, admin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const r = await pool.query(
    "select a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.full_name as actor_name from audit_logs a left join users u on u.id=a.actor_id order by a.created_at desc limit $1",
    [limit]
  );
  res.json({ logs: r.rows });
});

app.use((err, _req, res, _next) => { console.error("request error", err.message); res.status(500).json({ error: "حدث خطأ داخلي" }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => console.log(`Suhool Tech API listening on ${port}`));
