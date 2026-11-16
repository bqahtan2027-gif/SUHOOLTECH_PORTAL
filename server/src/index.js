import express from "express";
import crypto from "node:crypto";
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



const zatcaConnectionSchema = z.object({
  integration_mode: z.enum(["manual", "api"]).default("manual"),
  portal_url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  api_base_url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  api_enabled: z.boolean().default(false)
}).superRefine((value, ctx) => {
  for (const field of ["portal_url", "api_base_url"]) {
    const url = value[field];
    if (url && !url.startsWith("https://")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "يجب استخدام رابط HTTPS آمن" });
  }
  if (value.api_enabled && (!value.api_base_url || value.integration_mode !== "api")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["api_base_url"], message: "أدخل عنوان API واختر وضع API قبل التفعيل" });
  }
});
app.get("/api/zatca/connection", auth, admin, async (_req, res) => {
  try {
    const result = await pool.query("select integration_mode, portal_url, api_base_url, api_enabled, updated_at from zatca_connection_settings where id=1");
    res.json({ settings: result.rows[0] || { integration_mode: "manual", portal_url: null, api_base_url: null, api_enabled: false } });
  } catch (error) {
    console.error("ZATCA connection settings read failed", error.message);
    res.status(503).json({ error: "تعذر تحميل إعدادات الربط. تحقق من تطبيق تحديث قاعدة البيانات." });
  }
});
app.put("/api/zatca/connection", auth, admin, async (req, res) => {
  const parsed = zatcaConnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "تحقق من إعدادات الربط" });
  const value = parsed.data;
  try {
    const result = await pool.query(`
      insert into zatca_connection_settings (id, integration_mode, portal_url, api_base_url, api_enabled, updated_by, updated_at)
      values (1, $1, nullif($2, ''), nullif($3, ''), $4, $5, now())
      on conflict (id) do update set integration_mode=excluded.integration_mode,
        portal_url=excluded.portal_url, api_base_url=excluded.api_base_url,
        api_enabled=excluded.api_enabled, updated_by=excluded.updated_by, updated_at=now()
      returning integration_mode, portal_url, api_base_url, api_enabled, updated_at
    `, [value.integration_mode, value.portal_url || "", value.api_base_url || "", value.api_enabled, req.user.sub]);
    await audit(req.user.sub, "zatca.connection_settings_updated", "zatca_connection_settings", "1", { integration_mode: value.integration_mode, api_enabled: value.api_enabled });
    res.json({ settings: result.rows[0] });
  } catch (error) {
    console.error("ZATCA connection settings update failed", error.message);
    res.status(500).json({ error: "تعذر حفظ إعدادات الربط" });
  }
});

const meetingPayloadSchema = z.object({
  title:z.string().trim().min(3).max(200),
  description:z.string().max(4000).optional(),
  location:z.string().trim().max(240).optional(),
  starts_at:z.string().datetime({offset:true}),
  ends_at:z.string().datetime({offset:true}),
  attendee_ids:z.array(z.string().uuid()).max(100).default([])
}).refine(v=>new Date(v.ends_at)>new Date(v.starts_at),{message:"وقت نهاية الاجتماع يجب أن يكون بعد بدايته"});
app.get("/api/meetings/users",auth,async(req,res)=>{
  try{
    const r=await pool.query("select id,full_name,email from users where active=true and id<>$1 order by full_name limit 300",[req.user.sub]);
    res.json({users:r.rows});
  }catch(error){console.error("meeting users failed",error.message);res.status(503).json({error:"تعذر تحميل قائمة الموظفين"});}
});
app.get("/api/meetings",auth,async(req,res)=>{
  try{
    const r=await pool.query(`
      select m.id,m.title,m.description,m.location,m.starts_at,m.ends_at,m.status,m.organizer_id,m.created_at,
        o.full_name as organizer_name,
        coalesce(json_agg(json_build_object('user_id',u.id,'full_name',u.full_name,'response',a.response))
          filter(where u.id is not null),'[]'::json) as attendees
      from meetings m
      left join users o on o.id=m.organizer_id
      left join meeting_attendees a on a.meeting_id=m.id
      left join users u on u.id=a.user_id
      where m.organizer_id=$1 or exists(select 1 from meeting_attendees mine where mine.meeting_id=m.id and mine.user_id=$1)
        or $2='admin'
      group by m.id,o.full_name
      order by m.starts_at desc limit 300
    `,[req.user.sub,req.user.role]);
    res.json({meetings:r.rows});
  }catch(error){console.error("meetings list failed",error.message);res.status(503).json({error:"تعذر تحميل الاجتماعات. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/meetings",auth,async(req,res)=>{
  const p=meetingPayloadSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"تحقق من عنوان الاجتماع وتوقيته"});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const attendeeIds=[...new Set(p.data.attendee_ids)].filter(id=>id!==req.user.sub);
    if(attendeeIds.length){
      const valid=await client.query("select id from users where active=true and id=any($1::uuid[])",[attendeeIds]);
      if(valid.rowCount!==attendeeIds.length){await client.query("rollback");return res.status(400).json({error:"بعض المشاركين غير موجودين أو حساباتهم غير نشطة"});}
    }
    const created=await client.query(
      "insert into meetings(title,description,location,starts_at,ends_at,organizer_id) values($1,$2,$3,$4,$5,$6) returning id",
      [p.data.title,p.data.description||null,p.data.location||null,p.data.starts_at,p.data.ends_at,req.user.sub]
    );
    if(attendeeIds.length)await client.query("insert into meeting_attendees(meeting_id,user_id) select $1,unnest($2::uuid[])",[created.rows[0].id,attendeeIds]);
    await client.query("commit");
    await audit(req.user.sub,"meeting.created","meeting",created.rows[0].id,{attendees:attendeeIds.length});
    const result=await pool.query(`
      select m.*,o.full_name as organizer_name,
        coalesce(json_agg(json_build_object('user_id',u.id,'full_name',u.full_name,'response',a.response))
          filter(where u.id is not null),'[]'::json) as attendees
      from meetings m left join users o on o.id=m.organizer_id
      left join meeting_attendees a on a.meeting_id=m.id left join users u on u.id=a.user_id
      where m.id=$1 group by m.id,o.full_name
    `,[created.rows[0].id]);
    res.status(201).json({meeting:result.rows[0]});
  }catch(error){await client.query("rollback");console.error("meeting create failed",error.message);res.status(500).json({error:"تعذر إنشاء الاجتماع"});}
  finally{client.release();}
});
app.patch("/api/meetings/:id/status",auth,async(req,res)=>{
  const p=z.object({status:z.enum(["completed","cancelled"])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"حالة الاجتماع غير صالحة"});
  try{
    const r=await pool.query(
      "update meetings set status=$1,updated_at=now() where id=$2 and status='scheduled' and (organizer_id=$3 or $4='admin' or $4='manager') returning id,status,updated_at",
      [p.data.status,req.params.id,req.user.sub,req.user.role]
    );
    if(!r.rowCount)return res.status(404).json({error:"الاجتماع غير موجود أو لا تملك صلاحية تحديثه"});
    await audit(req.user.sub,"meeting.status_changed","meeting",req.params.id,{status:p.data.status});
    res.json({meeting:r.rows[0]});
  }catch(error){console.error("meeting status failed",error.message);res.status(500).json({error:"تعذر تحديث الاجتماع"});}
});
app.patch("/api/meetings/:id/response",auth,async(req,res)=>{
  const p=z.object({response:z.enum(["accepted","declined"])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"الرد غير صالح"});
  try{
    const r=await pool.query(
      "update meeting_attendees set response=$1,responded_at=now() where meeting_id=$2 and user_id=$3 and exists(select 1 from meetings m where m.id=$2 and m.status='scheduled') returning meeting_id,response",
      [p.data.response,req.params.id,req.user.sub]
    );
    if(!r.rowCount)return res.status(404).json({error:"الدعوة غير موجودة أو الاجتماع مغلق"});
    await audit(req.user.sub,"meeting.response_submitted","meeting",req.params.id,{response:p.data.response});
    res.json({response:r.rows[0].response});
  }catch(error){console.error("meeting response failed",error.message);res.status(500).json({error:"تعذر تسجيل الرد"});}
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


const hrManager = (req, res, next) => {
  if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ error: "هذه العملية متاحة للمدير ومدير النظام" });
  next();
};
app.get("/api/hr/assignable-users", auth, hrManager, async (_req,res)=>{
  try{
    const r=await pool.query("select id,full_name,email from users where active=true order by full_name limit 300");
    res.json({users:r.rows});
  }catch(error){console.error("assignable users failed",error.message);res.status(503).json({error:"تعذر تحميل حسابات الموظفين"});}
});
app.get("/api/hr/employees", auth, hrManager, async (_req, res) => {
  try {
    const r = await pool.query("select id,employee_number,full_name,email,phone,department,job_title,hire_date,status,created_at from employees order by created_at desc limit 300");
    res.json({ employees: r.rows });
  } catch (error) { console.error("employee list failed",error.message); res.status(503).json({error:"تعذر تحميل الموظفين. تحقق من تحديث قاعدة البيانات."}); }
});
app.post("/api/hr/employees", auth, hrManager, async (req, res) => {
  const p=z.object({
    full_name:z.string().trim().min(2).max(160),email:z.string().email().max(254).optional().or(z.literal("")),
    phone:z.string().max(40).optional(),department:z.string().max(120).optional(),job_title:z.string().max(120).optional(),
    hire_date:z.string().date().optional(),user_id:z.string().uuid().optional()
  }).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"تحقق من بيانات الموظف"});
  try {
    const r=await pool.query("insert into employees(employee_number,full_name,email,phone,department,job_title,hire_date,user_id) values('EMP-' || lpad(nextval('employee_number_seq')::text,5,'0'),$1,$2,$3,$4,$5,$6,$7) returning *",
      [p.data.full_name,p.data.email||null,p.data.phone||null,p.data.department||null,p.data.job_title||null,p.data.hire_date||null,p.data.user_id||null]);
    await audit(req.user.sub,"hr.employee_created","employee",r.rows[0].id,{employee_number:r.rows[0].employee_number});
    res.status(201).json({employee:r.rows[0]});
  } catch(error){console.error("employee create failed",error.message);res.status(error.code==="23505"?409:500).json({error:error.code==="23505"?"البريد أو حساب المستخدم مرتبط بموظف آخر":"تعذر إضافة الموظف"});}
});
app.patch("/api/hr/employees/:id/status", auth, hrManager, async (req,res)=>{
  const p=z.object({status:z.enum(["active","on_leave","suspended","terminated"])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"حالة الموظف غير صالحة"});
  try{const r=await pool.query("update employees set status=$1,updated_at=now() where id=$2 returning id,employee_number,status",[p.data.status,req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:"الموظف غير موجود"});
    await audit(req.user.sub,"hr.employee_status_changed","employee",req.params.id,{status:p.data.status});res.json({employee:r.rows[0]});
  }catch(error){res.status(500).json({error:"تعذر تحديث حالة الموظف"});}
});
app.get("/api/hr/leaves", auth, async (req,res)=>{
  try{
    const isManager=["admin","manager"].includes(req.user.role);
    const sql=isManager
      ? "select l.id,l.leave_type,l.start_date,l.end_date,l.reason,l.status,l.created_at,u.full_name as requester_name from leave_requests l join users u on u.id=l.user_id order by l.created_at desc limit 300"
      : "select l.id,l.leave_type,l.start_date,l.end_date,l.reason,l.status,l.created_at,u.full_name as requester_name from leave_requests l join users u on u.id=l.user_id where l.user_id=$1 order by l.created_at desc limit 100";
    const r=await pool.query(sql,isManager?[]:[req.user.sub]);res.json({leaves:r.rows});
  }catch(error){console.error("leave list failed",error.message);res.status(503).json({error:"تعذر تحميل طلبات الإجازة"});}
});
app.post("/api/hr/leaves", auth, async (req,res)=>{
  const p=z.object({leave_type:z.enum(["annual","sick","unpaid","emergency","other"]),start_date:z.string().date(),end_date:z.string().date(),reason:z.string().max(1000).optional()}).refine(v=>v.end_date>=v.start_date).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"تحقق من نوع الإجازة وتواريخها"});
  try{
    const r=await pool.query("insert into leave_requests(user_id,leave_type,start_date,end_date,reason) values($1,$2,$3,$4,$5) returning *",[req.user.sub,p.data.leave_type,p.data.start_date,p.data.end_date,p.data.reason||null]);
    await audit(req.user.sub,"hr.leave_requested","leave_request",r.rows[0].id,{leave_type:p.data.leave_type});
    res.status(201).json({leave:r.rows[0]});
  }catch(error){console.error("leave request failed",error.message);res.status(500).json({error:"تعذر إرسال طلب الإجازة"});}
});
app.patch("/api/hr/leaves/:id/status", auth, hrManager, async (req,res)=>{
  const p=z.object({status:z.enum(["approved","rejected"])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"قرار الاعتماد غير صالح"});
  try{
    const r=await pool.query("update leave_requests set status=$1,reviewed_by=$2,reviewed_at=now() where id=$3 and status='pending' returning id,status",[p.data.status,req.user.sub,req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:"الطلب غير موجود أو سبق اتخاذ قرار فيه"});
    await audit(req.user.sub,"hr.leave_"+p.data.status,"leave_request",req.params.id);
    res.json({leave:r.rows[0]});
  }catch(error){res.status(500).json({error:"تعذر تحديث طلب الإجازة"});}
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


const documentManager = (req, res, next) => {
  if (![ "admin", "manager" ].includes(req.user.role)) return res.status(403).json({ error: "إدارة دورة اعتماد المستندات متاحة للمدير ومدير النظام" });
  next();
};
const documentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  document_type: z.enum(["contract","policy","letter","nda","other"]),
  party_name: z.string().trim().max(180).optional(),
  content: z.string().min(1).max(30000)
});
app.get("/api/documents", auth, async (req, res) => {
  try {
    const manager = ["admin","manager"].includes(req.user.role);
    const sql = manager
      ? "select id,document_number,title,document_type,party_name,content,status,created_at,updated_at from documents order by created_at desc limit 300"
      : "select id,document_number,title,document_type,party_name,content,status,created_at,updated_at from documents where created_by=$1 order by created_at desc limit 100";
    const result = await pool.query(sql, manager ? [] : [req.user.sub]);
    res.json({ documents: result.rows });
  } catch (error) {
    console.error("documents list failed", error.message);
    res.status(503).json({ error: "تعذر تحميل المستندات. تحقق من تطبيق تحديث قاعدة البيانات." });
  }
});
app.post("/api/documents", auth, async (req, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "تحقق من عنوان المستند ونوعه ومحتواه" });
  try {
    const number = await pool.query("select nextval('document_number_seq') as n");
    const documentNumber = `DOC-${new Date().getFullYear()}-${String(number.rows[0].n).padStart(6,"0")}`;
    const result = await pool.query(
      "insert into documents(document_number,title,document_type,party_name,content,created_by) values($1,$2,$3,$4,$5,$6) returning id,document_number,title,document_type,party_name,content,status,created_at,updated_at",
      [documentNumber,parsed.data.title,parsed.data.document_type,parsed.data.party_name || null,parsed.data.content,req.user.sub]
    );
    await audit(req.user.sub,"document.created","document",result.rows[0].id,{document_number:documentNumber});
    res.status(201).json({ document: result.rows[0] });
  } catch (error) {
    console.error("document create failed", error.message);
    res.status(500).json({ error: "تعذر إنشاء المستند" });
  }
});
app.patch("/api/documents/:id/status", auth, async (req, res) => {
  const parsed = z.object({status:z.enum(["review","approved","rejected","draft","archived"])}).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:"حالة المستند غير صالحة"});
  const transitions = {
    draft:["review"], review:["approved","rejected"], rejected:["draft"],
    approved:["archived"], archived:[]
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select id,status,created_by from documents where id=$1 for update",[req.params.id]);
    if (!current.rowCount) { await client.query("rollback"); return res.status(404).json({error:"المستند غير موجود"}); }
    const from = current.rows[0].status;
    const to = parsed.data.status;
    const manager = ["admin","manager"].includes(req.user.role);
    const ownerSubmission = current.rows[0].created_by === req.user.sub && from === "draft" && to === "review";
    if ((!manager && !ownerSubmission) || !transitions[from]?.includes(to)) {
      await client.query("rollback");
      return res.status(409).json({error:"لا يمكن تنفيذ هذا الانتقال في دورة اعتماد المستند"});
    }
    const updated = await client.query(
      "update documents set status=$1,updated_at=now(),reviewed_by=case when $1 in ('approved','rejected') then $2 else reviewed_by end,reviewed_at=case when $1 in ('approved','rejected') then now() else reviewed_at end,archived_at=case when $1='archived' then now() else archived_at end where id=$3 returning id,status,updated_at,reviewed_by,reviewed_at,archived_at",
      [to,req.user.sub,req.params.id]
    );
    await client.query("commit");
    await audit(req.user.sub,"document.status_changed","document",req.params.id,{from,to});
    res.json({document:updated.rows[0]});
  } catch(error) {
    await client.query("rollback");
    console.error("document status update failed",error.message);
    res.status(500).json({error:"تعذر تحديث حالة المستند"});
  } finally { client.release(); }
});


const adminServicesManager = (req,res,next) => {
  if (!["admin","manager"].includes(req.user.role)) return res.status(403).json({error:"هذه العملية متاحة للمدير ومدير النظام"});
  next();
};
const adminRequestSchema = z.object({
  request_type:z.enum(["purchase","administrative"]),
  title:z.string().trim().min(3).max(200),
  description:z.string().max(5000).optional(),
  supplier_name:z.string().trim().max(180).optional(),
  estimated_amount:z.number().min(0).max(100000000000).optional(),
  priority:z.enum(["low","normal","high","urgent"]).default("normal")
});
app.get("/api/admin/requests",auth,async(req,res)=>{
  try{
    const manager=["admin","manager"].includes(req.user.role);
    const sql=manager
      ? "select r.*,u.full_name as requester_name from admin_requests r left join users u on u.id=r.requester_id order by r.created_at desc limit 300"
      : "select r.*,u.full_name as requester_name from admin_requests r left join users u on u.id=r.requester_id where r.requester_id=$1 order by r.created_at desc limit 100";
    const result=await pool.query(sql,manager?[]:[req.user.sub]);
    res.json({requests:result.rows});
  }catch(error){console.error("admin requests list failed",error.message);res.status(503).json({error:"تعذر تحميل الطلبات الإدارية. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/admin/requests",auth,async(req,res)=>{
  const p=adminRequestSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"تحقق من نوع الطلب وعنوانه والتكلفة"});
  try{
    const n=await pool.query("select nextval('admin_request_number_seq') as n");
    const requestNumber=`ADM-${new Date().getFullYear()}-${String(n.rows[0].n).padStart(6,"0")}`;
    const result=await pool.query(
      "insert into admin_requests(request_number,request_type,title,description,supplier_name,estimated_amount,priority,requester_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",
      [requestNumber,p.data.request_type,p.data.title,p.data.description||null,p.data.supplier_name||null,p.data.estimated_amount??null,p.data.priority,req.user.sub]
    );
    await audit(req.user.sub,"admin.request_created","admin_request",result.rows[0].id,{request_number:requestNumber,request_type:p.data.request_type});
    res.status(201).json({request:result.rows[0]});
  }catch(error){console.error("admin request create failed",error.message);res.status(500).json({error:"تعذر إنشاء الطلب"});}
});
app.patch("/api/admin/requests/:id/status",auth,adminServicesManager,async(req,res)=>{
  const p=z.object({status:z.enum(["approved","rejected","fulfilled"]),decision_note:z.string().max(1000).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"حالة الطلب أو الملاحظة غير صالحة"});
  const client=await pool.connect();
  try{
    await client.query("begin");
    const current=await client.query("select id,status,requester_id from admin_requests where id=$1 for update",[req.params.id]);
    if(!current.rowCount){await client.query("rollback");return res.status(404).json({error:"الطلب غير موجود"});}
    const from=current.rows[0].status,to=p.data.status;
    if(current.rows[0].requester_id===req.user.sub){await client.query("rollback");return res.status(403).json({error:"لا يمكن اعتماد طلبك بنفسك؛ يلزم اعتماد مدير آخر"});}
    const allowed=from==="pending"?["approved","rejected"]:from==="approved"?["fulfilled"]:[];
    if(!allowed.includes(to)){await client.query("rollback");return res.status(409).json({error:"لا يمكن تنفيذ هذا الانتقال على حالة الطلب الحالية"});}
    const updated=await client.query(
      "update admin_requests set status=$1,decision_note=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() where id=$4 returning id,request_number,status,decision_note,reviewed_by,reviewed_at,updated_at",
      [to,p.data.decision_note||null,req.user.sub,req.params.id]
    );
    await client.query("commit");
    await audit(req.user.sub,"admin.request_status_changed","admin_request",req.params.id,{from,to});
    res.json({request:updated.rows[0]});
  }catch(error){await client.query("rollback");console.error("admin request status failed",error.message);res.status(500).json({error:"تعذر تحديث الطلب"});}
  finally{client.release();}
});
app.get("/api/admin/custody",auth,async(req,res)=>{
  try{
    const manager=["admin","manager"].includes(req.user.role);
    const sql=manager
      ? "select a.*,u.full_name as assignee_name from custody_assets a left join users u on u.id=a.assigned_to order by a.assigned_at desc limit 500"
      : "select a.*,u.full_name as assignee_name from custody_assets a left join users u on u.id=a.assigned_to where a.assigned_to=$1 order by a.assigned_at desc limit 200";
    const result=await pool.query(sql,manager?[]:[req.user.sub]);
    res.json({assets:result.rows});
  }catch(error){console.error("custody list failed",error.message);res.status(503).json({error:"تعذر تحميل سجل العهد. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/admin/custody",auth,adminServicesManager,async(req,res)=>{
  const p=z.object({
    asset_name:z.string().trim().min(2).max(180),serial_number:z.string().trim().max(120).optional(),
    assigned_to:z.string().uuid(),condition_note:z.string().max(1000).optional()
  }).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"تحقق من اسم الأصل والموظف"});
  try{
    const result=await pool.query(
      "insert into custody_assets(asset_number,asset_name,serial_number,assigned_to,assigned_by,condition_note) select 'AST-' || lpad(nextval('custody_asset_number_seq')::text,6,'0'),$1,$2,u.id,$4,$5 from users u where u.id=$3 and u.active=true returning *",
      [p.data.asset_name,p.data.serial_number||null,p.data.assigned_to,req.user.sub,p.data.condition_note||null]
    );
    if(!result.rowCount)return res.status(400).json({error:"حساب الموظف غير موجود أو غير نشط"});
    await audit(req.user.sub,"admin.custody_assigned","custody_asset",result.rows[0].id,{asset_number:result.rows[0].asset_number,assigned_to:p.data.assigned_to});
    const named=await pool.query("select a.*,u.full_name as assignee_name from custody_assets a left join users u on u.id=a.assigned_to where a.id=$1",[result.rows[0].id]);
    res.status(201).json({asset:named.rows[0]});
  }catch(error){console.error("custody create failed",error.message);res.status(500).json({error:"تعذر تسجيل العهدة"});}
});
app.patch("/api/admin/custody/:id/status",auth,adminServicesManager,async(req,res)=>{
  const p=z.object({status:z.enum(["returned","damaged"])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"حالة العهدة غير صالحة"});
  try{
    const result=await pool.query(
      "update custody_assets set status=$1,returned_at=now() where id=$2 and status='assigned' returning id,asset_number,status,returned_at",
      [p.data.status,req.params.id]
    );
    if(!result.rowCount)return res.status(404).json({error:"العهدة غير موجودة أو سبق إغلاقها"});
    await audit(req.user.sub,"admin.custody_status_changed","custody_asset",req.params.id,{status:p.data.status});
    res.json({asset:result.rows[0]});
  }catch(error){console.error("custody status failed",error.message);res.status(500).json({error:"تعذر تحديث العهدة"});}
});


function vaultKey() {
  const key=Buffer.from(process.env.VAULT_ENCRYPTION_KEY||"","base64");
  if(key.length!==32)throw new Error("VAULT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}
function encryptVaultSecret(secret) {
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",vaultKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
  return {ciphertext:ciphertext.toString("base64"),iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")};
}
function decryptVaultSecret(row) {
  const decipher=crypto.createDecipheriv("aes-256-gcm",vaultKey(),Buffer.from(row.secret_iv,"hex"));
  decipher.setAuthTag(Buffer.from(row.secret_tag,"hex"));
  return Buffer.concat([decipher.update(Buffer.from(row.secret_ciphertext,"base64")),decipher.final()]).toString("utf8");
}
const vaultSchema=z.object({title:z.string().trim().min(2).max(160),username:z.string().max(254).optional(),secret:z.string().min(1).max(4096),notes:z.string().max(2000).optional(),scope:z.enum(["private","shared"]).default("private")});
app.get("/api/vault",auth,async(req,res)=>{
 try{
  const r=await pool.query("select v.id,v.title,v.username,v.notes,v.scope,v.owner_id,v.created_at,v.updated_at,u.full_name as owner_name from vault_items v join users u on u.id=v.owner_id where v.scope='shared' or v.owner_id=$1 order by v.updated_at desc limit 300",[req.user.sub]);
  res.set("Cache-Control","no-store");res.json({items:r.rows});
 }catch(error){console.error("vault list failed",error.message);res.status(503).json({error:"تعذر تحميل الخزنة. تحقق من تطبيق تحديث قاعدة البيانات."});}
});
app.post("/api/vault",auth,async(req,res)=>{
 const p=vaultSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من عنوان السجل والسر"});
 if(p.data.scope==="shared"&&!["admin","manager"].includes(req.user.role))return res.status(403).json({error:"إنشاء أسرار مشتركة متاح للمدير ومدير النظام"});
 let encrypted;try{encrypted=encryptVaultSecret(p.data.secret);}catch(error){console.error("vault encryption configuration error",error.message);return res.status(503).json({error:"الخزنة غير مهيأة. يجب ضبط مفتاح التشفير على الخادم أولاً."});}
 try{
  const r=await pool.query("insert into vault_items(title,username,secret_ciphertext,secret_iv,secret_tag,notes,scope,owner_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,title,username,notes,scope,owner_id,created_at,updated_at",[p.data.title,p.data.username||null,encrypted.ciphertext,encrypted.iv,encrypted.tag,p.data.notes||null,p.data.scope,req.user.sub]);
  await audit(req.user.sub,"vault.secret_created","vault_item",r.rows[0].id,{scope:p.data.scope});res.status(201).json({item:{...r.rows[0],owner_name:"أنت"}});
 }catch(error){console.error("vault create failed",error.message);res.status(500).json({error:"تعذر حفظ السر المشفر"});}
});
app.get("/api/vault/:id/reveal",auth,rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false}),async(req,res)=>{
 try{
  const r=await pool.query("select v.* from vault_items v where v.id=$1 and (v.scope='shared' or v.owner_id=$2)",[req.params.id,req.user.sub]);
  if(!r.rowCount)return res.status(404).json({error:"السجل غير موجود أو لا تملك صلاحية عرضه"});
  const secret=decryptVaultSecret(r.rows[0]);await audit(req.user.sub,"vault.secret_revealed","vault_item",req.params.id,{scope:r.rows[0].scope});
  res.set("Cache-Control","no-store");res.set("Pragma","no-cache");res.json({secret});
 }catch(error){console.error("vault reveal failed",error.message);res.status(503).json({error:"تعذر فك تشفير السر. تحقق من مفتاح الخزنة."});}
});
app.delete("/api/vault/:id",auth,async(req,res)=>{
 try{
  const r=await pool.query("delete from vault_items where id=$1 and ((scope='private' and owner_id=$2) or (scope='shared' and $3 in ('admin','manager'))) returning id,scope",[req.params.id,req.user.sub,req.user.role]);
  if(!r.rowCount)return res.status(404).json({error:"السجل غير موجود أو لا تملك صلاحية حذفه"});
  await audit(req.user.sub,"vault.secret_deleted","vault_item",req.params.id,{scope:r.rows[0].scope});res.json({deleted:true});
 }catch(error){console.error("vault delete failed",error.message);res.status(500).json({error:"تعذر حذف السجل"});}
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


const inventoryManager=(req,res,next)=>["admin","manager"].includes(req.user.role)?next():res.status(403).json({error:"هذه العملية متاحة للمدير ومدير النظام"});
app.get("/api/inventory/warehouses",auth,async(_req,res)=>{
 try{const r=await pool.query("select id,warehouse_code,name,location from warehouses where is_active=true order by name");res.json({warehouses:r.rows});}
 catch(error){console.error("warehouses list failed",error.message);res.status(503).json({error:"تعذر تحميل المستودعات. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/inventory/warehouses",auth,inventoryManager,async(req,res)=>{
 const p=z.object({warehouse_code:z.string().trim().min(2).max(32),name:z.string().trim().min(2).max(160),location:z.string().max(500).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من رمز واسم المستودع"});
 try{const r=await pool.query("insert into warehouses(warehouse_code,name,location,created_by) values($1,$2,$3,$4) returning id,warehouse_code,name,location",[p.data.warehouse_code,p.data.name,p.data.location||null,req.user.sub]);await audit(req.user.sub,"inventory.warehouse_created","warehouse",r.rows[0].id);res.status(201).json({warehouse:r.rows[0]});}
 catch(error){res.status(error.code==="23505"?409:500).json({error:error.code==="23505"?"رمز المستودع مستخدم مسبقاً":"تعذر إنشاء المستودع"});}
});
app.get("/api/inventory/items",auth,async(_req,res)=>{
 try{const r=await pool.query("select id,sku,name,unit,cost_price,reorder_level from inventory_items where is_active=true order by name");res.json({items:r.rows});}
 catch(error){console.error("inventory items failed",error.message);res.status(503).json({error:"تعذر تحميل الأصناف. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/inventory/items",auth,inventoryManager,async(req,res)=>{
 const p=z.object({sku:z.string().trim().min(1).max(80),name:z.string().trim().min(2).max(200),unit:z.string().trim().min(1).max(30).default("piece"),cost_price:z.coerce.number().min(0).max(999999999),reorder_level:z.coerce.number().min(0).max(999999999)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من بيانات الصنف والتكلفة وحد إعادة الطلب"});
 try{const r=await pool.query("insert into inventory_items(sku,name,unit,cost_price,reorder_level) values($1,$2,$3,$4,$5) returning id,sku,name,unit,cost_price,reorder_level",[p.data.sku,p.data.name,p.data.unit,p.data.cost_price,p.data.reorder_level]);await audit(req.user.sub,"inventory.item_created","inventory_item",r.rows[0].id);res.status(201).json({item:r.rows[0]});}
 catch(error){res.status(error.code==="23505"?409:500).json({error:error.code==="23505"?"رمز الصنف مستخدم مسبقاً":"تعذر إنشاء الصنف"});}
});
app.get("/api/inventory/balances",auth,async(_req,res)=>{
 try{const r=await pool.query("select b.warehouse_id,b.item_id,w.name as warehouse_name,i.sku,i.name as item_name,i.unit,b.quantity,i.reorder_level from stock_balances b join warehouses w on w.id=b.warehouse_id join inventory_items i on i.id=b.item_id order by w.name,i.name");res.json({balances:r.rows});}
 catch(error){console.error("stock balances failed",error.message);res.status(503).json({error:"تعذر تحميل أرصدة المخزون. تحقق من تحديث قاعدة البيانات."});}
});
app.post("/api/inventory/documents",auth,inventoryManager,async(req,res)=>{
 const p=z.object({document_type:z.enum(["receipt","issue"]),warehouse_id:z.string().uuid(),item_id:z.string().uuid(),quantity:z.coerce.number().positive().max(999999999),unit_cost:z.coerce.number().min(0).max(999999999).default(0),notes:z.string().max(1000).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من نوع الحركة والمستودع والصنف والكمية"});
 const client=await pool.connect();
 try{
  await client.query("begin");
  const wh=await client.query("select id from warehouses where id=$1 and is_active=true",[p.data.warehouse_id]);
  const item=await client.query("select id from inventory_items where id=$1 and is_active=true",[p.data.item_id]);
  if(!wh.rowCount||!item.rowCount){await client.query("rollback");return res.status(400).json({error:"المستودع أو الصنف غير موجود أو غير نشط"});}
  const balance=await client.query("select quantity from stock_balances where warehouse_id=$1 and item_id=$2 for update",[p.data.warehouse_id,p.data.item_id]);
  const available=Number(balance.rows[0]?.quantity||0);
  if(p.data.document_type==="issue"&&available<p.data.quantity){await client.query("rollback");return res.status(409).json({error:"الكمية المتاحة غير كافية للصرف"});}
  const number="STK-"+String(Date.now())+"-"+String(Math.floor(Math.random()*1000)).padStart(3,"0");
  const doc=await client.query("insert into stock_documents(document_number,document_type,status,source_warehouse_id,destination_warehouse_id,notes,created_by,posted_by,posted_at) values($1,$2,'posted',$3,$4,$5,$6,$6,now()) returning id,document_number,status,document_type",[number,p.data.document_type,p.data.document_type==="issue"?p.data.warehouse_id:null,p.data.document_type==="receipt"?p.data.warehouse_id:null,p.data.notes||null,req.user.sub]);
  await client.query("insert into stock_document_lines(document_id,item_id,quantity,unit_cost) values($1,$2,$3,$4)",[doc.rows[0].id,p.data.item_id,p.data.quantity,p.data.unit_cost]);
  const delta=p.data.document_type==="receipt"?p.data.quantity:-p.data.quantity;
  await client.query("insert into stock_balances(warehouse_id,item_id,quantity) values($1,$2,greatest($3,0)) on conflict(warehouse_id,item_id) do update set quantity=stock_balances.quantity+$3,updated_at=now()",[p.data.warehouse_id,p.data.item_id,delta]);
  await client.query("commit");
  await audit(req.user.sub,"inventory.stock_"+p.data.document_type,"stock_document",doc.rows[0].id,{quantity:p.data.quantity,sku:p.data.item_id});
  res.status(201).json({document:doc.rows[0]});
 }catch(error){await client.query("rollback");console.error("stock document failed",error.message);res.status(500).json({error:"تعذر تسجيل حركة المخزون"});}
 finally{client.release();}
});


const financeManager=(req,res,next)=>["admin","manager"].includes(req.user.role)?next():res.status(403).json({error:"هذه العملية متاحة للمدير ومدير النظام"});
app.get("/api/finance/summary",auth,async(_req,res)=>{
 try{
  const [accounts,parties,journals,invoices]=await Promise.all([
   pool.query("select count(*)::int as count from finance_accounts where is_active=true"),
   pool.query("select count(*)::int as count from finance_parties"),
   pool.query("select count(*)::int as count from journal_entries"),
   pool.query("select count(*)::int as count,coalesce(sum(total) filter(where status<>'cancelled'),0)::numeric(16,2) as total from sales_invoices")
  ]);
  res.json({accounts:Number(accounts.rows[0].count),parties:Number(parties.rows[0].count),journals:Number(journals.rows[0].count),invoice_count:Number(invoices.rows[0].count),invoice_total:invoices.rows[0].total});
 }catch(error){console.error("finance summary failed",error.message);res.status(503).json({error:"تعذر تحميل الملخص المالي. تحقق من تحديث قاعدة البيانات."});}
});
app.get("/api/finance/accounts",auth,async(_req,res)=>{
 try{const r=await pool.query("select id,account_code,account_name,account_type,parent_id from finance_accounts where is_active=true order by account_code");res.json({accounts:r.rows});}
 catch(error){res.status(503).json({error:"تعذر تحميل دليل الحسابات"});}
});
app.post("/api/finance/accounts",auth,financeManager,async(req,res)=>{
 const p=z.object({account_code:z.string().trim().min(1).max(30),account_name:z.string().trim().min(2).max(180),account_type:z.enum(["asset","liability","equity","revenue","expense"]),parent_id:z.string().uuid().nullable().optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من بيانات الحساب"});
 try{const r=await pool.query("insert into finance_accounts(account_code,account_name,account_type,parent_id) values($1,$2,$3,$4) returning *",[p.data.account_code,p.data.account_name,p.data.account_type,p.data.parent_id||null]);await audit(req.user.sub,"finance.account_created","finance_account",r.rows[0].id);res.status(201).json({account:r.rows[0]});}
 catch(error){res.status(error.code==="23505"?409:400).json({error:error.code==="23505"?"رقم الحساب مستخدم مسبقاً":"تعذر إنشاء الحساب"});}
});
app.get("/api/finance/parties",auth,async(_req,res)=>{
 try{const r=await pool.query("select id,party_type,name,tax_number,email,phone from finance_parties order by name");res.json({parties:r.rows});}
 catch(error){res.status(503).json({error:"تعذر تحميل العملاء والموردين"});}
});
app.post("/api/finance/parties",auth,financeManager,async(req,res)=>{
 const p=z.object({party_type:z.enum(["customer","supplier","both"]),name:z.string().trim().min(2).max(180),tax_number:z.string().max(30).optional(),email:z.string().email().max(254).optional().or(z.literal("")),phone:z.string().max(40).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من بيانات العميل أو المورد"});
 try{const r=await pool.query("insert into finance_parties(party_type,name,tax_number,email,phone) values($1,$2,$3,$4,$5) returning *",[p.data.party_type,p.data.name,p.data.tax_number||null,p.data.email||null,p.data.phone||null]);await audit(req.user.sub,"finance.party_created","finance_party",r.rows[0].id);res.status(201).json({party:r.rows[0]});}
 catch(error){res.status(500).json({error:"تعذر حفظ العميل أو المورد"});}
});
app.get("/api/finance/journals",auth,async(_req,res)=>{
 try{const r=await pool.query("select e.id,e.entry_number,e.entry_date,e.description,e.status,coalesce(sum(l.debit),0)::numeric(16,2) as debit,coalesce(sum(l.credit),0)::numeric(16,2) as credit from journal_entries e left join journal_lines l on l.entry_id=e.id group by e.id order by e.entry_date desc,e.created_at desc limit 100");res.json({journals:r.rows});}
 catch(error){res.status(503).json({error:"تعذر تحميل القيود اليومية"});}
});
app.post("/api/finance/journals",auth,financeManager,async(req,res)=>{
 const p=z.object({entry_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),description:z.string().trim().min(2).max(1000),lines:z.array(z.object({account_id:z.string().uuid(),description:z.string().max(500).optional(),debit:z.coerce.number().min(0).max(999999999),credit:z.coerce.number().min(0).max(999999999)})).min(2).max(100)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"بيانات القيد غير مكتملة"});
 const debit=p.data.lines.reduce((s,l)=>s+l.debit,0),credit=p.data.lines.reduce((s,l)=>s+l.credit,0);
 if(debit<=0||Math.abs(debit-credit)>0.005||p.data.lines.some(l=>(l.debit>0)===(l.credit>0)))return res.status(400).json({error:"القيد غير متوازن أو يحتوي سطراً غير صحيح"});
 const client=await pool.connect();
 try{
  await client.query("begin");
  const ids=[...new Set(p.data.lines.map(l=>l.account_id))];
  const found=await client.query("select id from finance_accounts where id=any($1::uuid[]) and is_active=true", [ids]);
  if(found.rowCount!==ids.length)throw new Error("INVALID_ACCOUNT");
  const number="JE-"+Date.now();
  const entry=await client.query("insert into journal_entries(entry_number,entry_date,description,created_by) values($1,$2,$3,$4) returning id,entry_number,entry_date,description,status",[number,p.data.entry_date,p.data.description,req.user.sub]);
  for(const line of p.data.lines)await client.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,$5)",[entry.rows[0].id,line.account_id,line.description||null,line.debit,line.credit]);
  await client.query("commit");await audit(req.user.sub,"finance.journal_created","journal_entry",entry.rows[0].id,{debit,credit});res.status(201).json({journal:entry.rows[0],debit,credit});
 }catch(error){await client.query("rollback");if(error.message==="INVALID_ACCOUNT")return res.status(400).json({error:"يوجد حساب غير نشط أو غير موجود"});console.error("journal create failed",error.message);res.status(500).json({error:"تعذر حفظ القيد"});}
 finally{client.release();}
});
app.post("/api/finance/journals/:id/post",auth,financeManager,async(req,res)=>{
 const client=await pool.connect();
 try{await client.query("begin");const e=await client.query("select id,status from journal_entries where id=$1 for update",[req.params.id]);if(!e.rowCount||e.rows[0].status!=="draft"){await client.query("rollback");return res.status(409).json({error:"القيد غير موجود أو ليس مسودة"});}const sums=await client.query("select coalesce(sum(debit),0) debit,coalesce(sum(credit),0) credit,count(*)::int lines from journal_lines where entry_id=$1",[req.params.id]);const s=sums.rows[0];if(Number(s.lines)<2||Math.abs(Number(s.debit)-Number(s.credit))>0.005||Number(s.debit)<=0){await client.query("rollback");return res.status(400).json({error:"لا يمكن ترحيل قيد غير متوازن"});}await client.query("update journal_entries set status='posted',posted_by=$2,posted_at=now() where id=$1",[req.params.id,req.user.sub]);await client.query("commit");await audit(req.user.sub,"finance.journal_posted","journal_entry",req.params.id);res.json({status:"posted"});}
 catch(error){await client.query("rollback");res.status(500).json({error:"تعذر ترحيل القيد"});}finally{client.release();}
});


// Sales invoices: draft creation, stock issue and balanced GL posting.
app.get("/api/finance/sales-invoices",auth,async(_req,res)=>{
 try{const r=await pool.query(`select i.*,p.name as customer_name,j.entry_number,s.document_number as stock_document_number,\n  coalesce((select json_agg(json_build_object('id',l.id,'item_id',l.item_id,'description',l.description,'quantity',l.quantity,'unit_price',l.unit_price) order by l.description) from sales_invoice_lines l where l.invoice_id=i.id),'[]'::json) as lines,
  coalesce((select sum(a.amount) from sales_receipt_allocations a where a.invoice_id=i.id),0)::numeric(16,2) as paid_amount
  from sales_invoices i left join finance_parties p on p.id=i.party_id
  left join journal_entries j on j.id=i.journal_entry_id left join stock_documents s on s.id=i.stock_document_id
  order by i.issue_date desc,i.created_at desc limit 300`);res.json({invoices:r.rows});}
 catch(e){console.error("sales invoice list failed",e.message);res.status(503).json({error:"تعذر تحميل فواتير المبيعات"});}
});
app.post("/api/finance/sales-invoices",auth,financeManager,async(req,res)=>{
 const p=z.object({party_id:z.string().uuid(),issue_date:z.string().date(),due_date:z.string().date().optional(),warehouse_id:z.string().uuid().optional(),discount_amount:z.coerce.number().min(0).max(999999999).default(0),lines:z.array(z.object({item_id:z.string().uuid().optional(),description:z.string().trim().min(2).max(500),quantity:z.coerce.number().positive().max(1000000),unit_price:z.coerce.number().min(0).max(999999999),tax_rate:z.coerce.number().min(0).max(100).default(15)})).min(1).max(100)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من العميل وتاريخ الفاتورة وبنودها"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const party=await db.query("select * from finance_parties where id=$1 and party_type in ('customer','both')",[p.data.party_id]);
  if(!party.rowCount)throw new Error("CUSTOMER_INVALID");
  if(p.data.warehouse_id){const wh=await db.query("select id from warehouses where id=$1 and is_active=true",[p.data.warehouse_id]);if(!wh.rowCount)throw new Error("WAREHOUSE_INVALID");}
  const lines=p.data.lines.map(l=>{const sub=Math.round(l.quantity*l.unit_price*100)/100;const tax=Math.round(sub*l.tax_rate)/100;return {...l,sub,tax,total:sub+tax};});
  const subtotal=Math.round(lines.reduce((s,l)=>s+l.sub,0)*100)/100;
  if(p.data.discount_amount>subtotal)throw new Error("DISCOUNT_INVALID");
  const discount=Math.round(p.data.discount_amount*100)/100;
  const taxable=Math.round((subtotal-discount)*100)/100;
  let discountAllocated=0;
  const adjustedLines=lines.map((line,index)=>{
   const share=index===lines.length-1?Math.round((discount-discountAllocated)*100)/100:Math.round(discount*line.sub/(subtotal||1)*100)/100;
   discountAllocated+=share;
   const net=Math.max(0,Math.round((line.sub-share)*100)/100);
   const tax=Math.round(net*line.tax_rate)/100;
   return {...line,tax,total:Math.round((net+tax)*100)/100};
  });
  const taxAmount=Math.round(adjustedLines.reduce((s,l)=>s+l.tax,0)*100)/100;
  const total=Math.round((taxable+taxAmount)*100)/100;
  const n=await db.query("select nextval('sales_invoice_number_seq') n");
  const number="INV-"+new Date().getFullYear()+"-"+String(n.rows[0].n).padStart(7,"0");
  const inv=await db.query(`insert into sales_invoices(invoice_number,party_id,customer_name,customer_tax_number,issue_date,due_date,warehouse_id,status,subtotal,discount_amount,tax_rate,tax_amount,total,created_by)
   values($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,15,$10,$11,$12) returning *`,
   [number,p.data.party_id,party.rows[0].name,party.rows[0].tax_number,p.data.issue_date,p.data.due_date||null,p.data.warehouse_id||null,subtotal,discount,taxAmount,total,req.user.sub]);
  for(const l of adjustedLines)await db.query("insert into sales_invoice_lines(invoice_id,item_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[inv.rows[0].id,l.item_id||null,l.description,l.quantity,l.unit_price,l.tax_rate,l.sub,l.tax,l.total]);
  await db.query("commit");await audit(req.user.sub,"finance.sales_invoice_created","sales_invoice",inv.rows[0].id,{invoice_number:number,total});
  res.status(201).json({invoice:inv.rows[0]});
 }catch(e){await db.query("rollback");const messages={CUSTOMER_INVALID:"العميل غير موجود أو ليس عميلاً",WAREHOUSE_INVALID:"المستودع غير موجود أو غير نشط",DISCOUNT_INVALID:"الخصم يتجاوز قيمة الفاتورة"};const msg=messages[e.message];if(!msg)console.error("sales invoice create failed",e.message);res.status(msg?400:500).json({error:msg||"تعذر إنشاء فاتورة المبيعات"});}
 finally{db.release();}
});
app.post("/api/finance/sales-invoices/:id/post",auth,financeManager,async(req,res)=>{
 const p=z.object({receivable_account_id:z.string().uuid(),revenue_account_id:z.string().uuid(),output_tax_account_id:z.string().uuid(),cogs_account_id:z.string().uuid().optional(),inventory_account_id:z.string().uuid().optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"حدد حساب العملاء والإيرادات وضريبة المخرجات"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const ir=await db.query("select * from sales_invoices where id=$1 for update",[req.params.id]);
  if(!ir.rowCount||ir.rows[0].status!=="draft")throw new Error("INVOICE_NOT_DRAFT");
  const inv=ir.rows[0];
  const ids=[p.data.receivable_account_id,p.data.revenue_account_id,p.data.output_tax_account_id];
  if(new Set(ids).size!==3)throw new Error("ACCOUNTS_DIFFER");
  const ar=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[ids]);
  const types=new Map(ar.rows.map(x=>[x.id,x.account_type]));
  if(ar.rowCount!==3||types.get(p.data.receivable_account_id)!=="asset"||types.get(p.data.revenue_account_id)!=="revenue"||types.get(p.data.output_tax_account_id)!=="liability")throw new Error("ACCOUNT_TYPES");
  const lines=await db.query("select * from sales_invoice_lines where invoice_id=$1 order by id",[inv.id]);
  const stockLines=lines.rows.filter(l=>l.item_id);
  let stockDoc=null,costOfGoods=0;
  if(stockLines.length){
   if(!p.data.cogs_account_id||!p.data.inventory_account_id||p.data.cogs_account_id===p.data.inventory_account_id)throw new Error("COST_ACCOUNTS_REQUIRED");
   const ca=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[[p.data.cogs_account_id,p.data.inventory_account_id]]);
   const ct=new Map(ca.rows.map(x=>[x.id,x.account_type]));
   if(ca.rowCount!==2||ct.get(p.data.cogs_account_id)!=="expense"||ct.get(p.data.inventory_account_id)!=="asset")throw new Error("COST_ACCOUNT_TYPES");
  }
  if(stockLines.length){
   if(!inv.warehouse_id)throw new Error("WAREHOUSE_REQUIRED");
   for(const l of stockLines){
    const b=await db.query("select quantity from stock_balances where warehouse_id=$1 and item_id=$2 for update",[inv.warehouse_id,l.item_id]);
    if(!b.rowCount||Number(b.rows[0].quantity)<Number(l.quantity))throw new Error("INSUFFICIENT_STOCK");
   }
   const sd=await db.query(`insert into stock_documents(document_number,document_type,status,source_warehouse_id,reference_number,notes,created_by,posted_by,posted_at)
    values('SINV-'||lpad(nextval('sales_stock_issue_number_seq')::text,8,'0'),'issue','posted',$1,$2,'صرف مبيعات',$3,$3,now()) returning id,document_number`,[inv.warehouse_id,inv.invoice_number,req.user.sub]);
   stockDoc=sd.rows[0];
   for(const l of stockLines){
    const c=await db.query("select cost_price from inventory_items where id=$1 for share",[l.item_id]);
    if(!c.rowCount)throw new Error("INVENTORY_ITEM_MISSING");
    const unitCost=Number(c.rows[0].cost_price),lineCost=Math.round(unitCost*Number(l.quantity)*100)/100;
    costOfGoods=Math.round((costOfGoods+lineCost)*100)/100;
    await db.query("update sales_invoice_lines set cost_unit=$1,cost_total=$2 where id=$3",[unitCost,lineCost,l.id]);
    await db.query("insert into stock_document_lines(document_id,item_id,quantity,unit_cost) values($1,$2,$3,$4)",[stockDoc.id,l.item_id,l.quantity,unitCost]);
    const dec=await db.query("update stock_balances set quantity=quantity-$1,updated_at=now() where warehouse_id=$2 and item_id=$3 and quantity >= $1 returning quantity",[l.quantity,inv.warehouse_id,l.item_id]);
    if(!dec.rowCount)throw new Error("INSUFFICIENT_STOCK");
   }
  }
  const j=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),$1,$2,'posted','sales_invoice',$3,$4,$4,now()) returning id,entry_number`,
   [inv.issue_date,"فاتورة مبيعات "+inv.invoice_number,inv.id,req.user.sub]);
  if(Number(inv.total)>0)await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,$5,0)",[j.rows[0].id,p.data.receivable_account_id,inv.party_id,"ذمم العميل "+inv.invoice_number,inv.total]);
  const revenue=Number(inv.subtotal)-Number(inv.discount_amount);
  if(revenue>0)await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[j.rows[0].id,p.data.revenue_account_id,"إيرادات المبيعات "+inv.invoice_number,revenue]);
  if(Number(inv.tax_amount)>0)await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[j.rows[0].id,p.data.output_tax_account_id,"ضريبة مخرجات "+inv.invoice_number,inv.tax_amount]);
  if(costOfGoods>0){
   await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,0)",[j.rows[0].id,p.data.cogs_account_id,"تكلفة البضاعة المباعة "+inv.invoice_number,costOfGoods]);
   await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[j.rows[0].id,p.data.inventory_account_id,"تخفيض المخزون "+inv.invoice_number,costOfGoods]);
  }
  await db.query("update sales_invoices set status='issued',journal_entry_id=$1,receivable_account_id=$2,revenue_account_id=$3,output_tax_account_id=$4,stock_document_id=$5,posted_by=$6,posted_at=now(),cogs_account_id=$7,inventory_account_id=$8 where id=$9",[j.rows[0].id,p.data.receivable_account_id,p.data.revenue_account_id,p.data.output_tax_account_id,stockDoc?.id||null,req.user.sub,stockLines.length?p.data.cogs_account_id:null,stockLines.length?p.data.inventory_account_id:null,inv.id]);
  await db.query("commit");await audit(req.user.sub,"finance.sales_invoice_posted","sales_invoice",inv.id,{journal_entry_id:j.rows[0].id,stock_document_id:stockDoc?.id||null,total:inv.total});
  res.json({status:"issued",journal:j.rows[0],stock_document:stockDoc});
 }catch(e){await db.query("rollback");const messages={INVOICE_NOT_DRAFT:"الفاتورة غير موجودة أو سبق ترحيلها",ACCOUNTS_DIFFER:"يجب اختيار ثلاثة حسابات مختلفة",ACCOUNT_TYPES:"تحقق من أنواع حسابات العملاء والإيرادات والضريبة",WAREHOUSE_REQUIRED:"حدد مستودعاً قبل إصدار فاتورة تحتوي أصنافاً مخزنية",INSUFFICIENT_STOCK:"الرصيد المخزني غير كافٍ لإصدار الفاتورة"};const msg=messages[e.message];if(!msg)console.error("sales invoice post failed",e.message);res.status(msg?400:500).json({error:msg||"تعذر إصدار فاتورة المبيعات"});}
 finally{db.release();}
});


app.get("/api/finance/customer-receipts",auth,async(_req,res)=>{
 try{const r=await pool.query(`select r.*,p.name as customer_name,i.invoice_number,j.entry_number,a.account_code,a.account_name
  from finance_receipts r left join finance_parties p on p.id=r.party_id
  left join sales_invoices i on i.id=r.invoice_id left join journal_entries j on j.id=r.journal_entry_id
  left join finance_accounts a on a.id=r.payment_account_id
  order by r.received_at desc limit 300`);res.json({receipts:r.rows});}
 catch(e){console.error("customer receipts list failed",e.message);res.status(503).json({error:"تعذر تحميل سندات القبض"});}
});
app.post("/api/finance/customer-receipts",auth,financeManager,async(req,res)=>{
 const p=z.object({invoice_id:z.string().uuid(),amount:z.coerce.number().positive().max(999999999),payment_method:z.enum(["cash","bank_transfer","card","other"]),payment_account_id:z.string().uuid(),reference_number:z.string().max(100).optional(),received_at:z.string().datetime({offset:true}).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من الفاتورة والمبلغ وطريقة الدفع وحساب الصندوق أو البنك"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const ir=await db.query("select * from sales_invoices where id=$1 for update",[p.data.invoice_id]);
  if(!ir.rowCount||!["issued","partially_paid"].includes(ir.rows[0].status))throw new Error("INVOICE_UNAVAILABLE");
  const inv=ir.rows[0];
  if(!inv.receivable_account_id)throw new Error("AR_ACCOUNT_MISSING");
  const acc=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[ [p.data.payment_account_id,inv.receivable_account_id] ]);
  const types=new Map(acc.rows.map(x=>[x.id,x.account_type]));
  if(acc.rowCount!==2||types.get(p.data.payment_account_id)!=="asset"||types.get(inv.receivable_account_id)!=="asset"||p.data.payment_account_id===inv.receivable_account_id)throw new Error("INVALID_PAYMENT_ACCOUNT");
  const paid=await db.query("select coalesce(sum(amount),0)::numeric(16,2) amount from sales_receipt_allocations where invoice_id=$1",[inv.id]);
  const outstanding=Math.round((Number(inv.total)-Number(paid.rows[0].amount))*100)/100;
  const amount=Math.round(p.data.amount*100)/100;
  if(amount<=0||amount>outstanding+0.001)throw new Error("AMOUNT_EXCEEDS_DUE");
  const n=await db.query("select nextval('receipt_number_seq') n");
  const receiptNumber="RCPT-"+new Date().getFullYear()+"-"+String(n.rows[0].n).padStart(7,"0");
  const je=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),coalesce($1::date,current_date),$2,'posted','customer_receipt',gen_random_uuid(),$3,$3,now()) returning id,entry_number`,
   [p.data.received_at||null,"سند قبض "+receiptNumber+" للفاتورة "+inv.invoice_number,req.user.sub]);
  await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,$5,0)",[je.rows[0].id,p.data.payment_account_id,inv.party_id,"استلام دفعة "+receiptNumber,amount]);
  await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,0,$5)",[je.rows[0].id,inv.receivable_account_id,inv.party_id,"تسوية ذمم "+inv.invoice_number,amount]);
  const rr=await db.query(`insert into finance_receipts(receipt_number,party_id,invoice_id,amount,payment_method,reference_number,received_at,created_by,journal_entry_id,payment_account_id)
   values($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now()),$8,$9,$10) returning *`,
   [receiptNumber,inv.party_id,inv.id,amount,p.data.payment_method,p.data.reference_number||null,p.data.received_at||null,req.user.sub,je.rows[0].id,p.data.payment_account_id]);
  await db.query("insert into sales_receipt_allocations(receipt_id,invoice_id,amount) values($1,$2,$3)",[rr.rows[0].id,inv.id,amount]);
  const newPaid=Number(paid.rows[0].amount)+amount;
  const status=newPaid+0.001>=Number(inv.total)?"paid":"partially_paid";
  await db.query("update sales_invoices set status=$1,updated_at=now() where id=$2",[status,inv.id]);
  await db.query("commit");
  await audit(req.user.sub,"finance.customer_receipt_created","finance_receipt",rr.rows[0].id,{receipt_number:receiptNumber,invoice_number:inv.invoice_number,amount,status});
  res.status(201).json({receipt:rr.rows[0],invoice_status:status,outstanding:Math.max(0,Number(inv.total)-newPaid)});
 }catch(e){await db.query("rollback");const messages={INVOICE_UNAVAILABLE:"الفاتورة غير صادرة أو غير موجودة",AR_ACCOUNT_MISSING:"الفاتورة لا تحتوي حساب ذمم العملاء",INVALID_PAYMENT_ACCOUNT:"اختر حساب صندوق أو بنك نشطاً ومختلفاً عن حساب العملاء",AMOUNT_EXCEEDS_DUE:"مبلغ القبض أكبر من المبلغ المتبقي على الفاتورة"};const msg=messages[e.message];if(!msg)console.error("customer receipt create failed",e.message);res.status(msg?400:500).json({error:msg||"تعذر تسجيل سند القبض"});}
 finally{db.release();}
});


// Sales credit notes: quantities are capped against the original invoice and returned to stock on posting.
app.get("/api/finance/sales-credit-notes",auth,async(_req,res)=>{
 try{const r=await pool.query(`select c.*,i.invoice_number,p.name as customer_name,j.entry_number,s.document_number as stock_document_number,
  coalesce(r.refunded_amount,0)::numeric(16,2) refunded_amount,
  greatest(0,c.customer_credit_amount-coalesce(r.refunded_amount,0))::numeric(16,2) refundable_amount
  from sales_credit_notes c join sales_invoices i on i.id=c.original_invoice_id
  join finance_parties p on p.id=c.party_id left join journal_entries j on j.id=c.journal_entry_id
  left join stock_documents s on s.id=c.stock_document_id
  left join lateral (select sum(amount) refunded_amount from sales_credit_note_refunds where credit_note_id=c.id) r on true
  order by c.credit_date desc,c.created_at desc limit 300`);
  res.json({credit_notes:r.rows});}
 catch(e){console.error("sales credit note list failed",e.message);res.status(503).json({error:"تعذر تحميل الإشعارات الدائنة"});}
});
app.post("/api/finance/sales-credit-notes",auth,financeManager,async(req,res)=>{
 const p=z.object({original_invoice_id:z.string().uuid(),credit_date:z.string().date(),lines:z.array(z.object({original_invoice_line_id:z.string().uuid(),quantity:z.coerce.number().positive().max(1000000)})).min(1).max(100)}).safeParse(req.body);
 if(!p.success||new Set((p.success?p.data.lines:[]).map(x=>x.original_invoice_line_id)).size!==(p.success?p.data.lines.length:0))return res.status(400).json({error:"تحقق من الفاتورة الأصلية وبنود وكميات المرتجع"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const ir=await db.query("select * from sales_invoices where id=$1 for update",[p.data.original_invoice_id]);
  if(!ir.rowCount||!["issued","partially_paid","paid"].includes(ir.rows[0].status))throw new Error("ORIGINAL_INVOICE_INVALID");
  const inv=ir.rows[0],creditLines=[];
  for(const requested of p.data.lines){
   const lr=await db.query("select * from sales_invoice_lines where id=$1 and invoice_id=$2 for update",[requested.original_invoice_line_id,inv.id]);
   if(!lr.rowCount)throw new Error("ORIGINAL_LINE_INVALID");
   const line=lr.rows[0];
   const returned=await db.query(`select coalesce(sum(cl.quantity),0)::numeric(14,3) quantity
    from sales_credit_note_lines cl join sales_credit_notes cn on cn.id=cl.credit_note_id
    where cl.original_invoice_line_id=$1 and cn.status='issued'`,[line.id]);
   if(requested.quantity>Number(line.quantity)-Number(returned.rows[0].quantity)+0.0005)throw new Error("RETURN_QUANTITY_EXCEEDED");
   const subtotal=Math.round(Number(line.line_subtotal)*requested.quantity/Number(line.quantity)*100)/100;
   const tax=Math.round(Number(line.line_tax)*requested.quantity/Number(line.quantity)*100)/100;
   const costTotal=line.cost_unit===null||line.cost_unit===undefined?null:Math.round(Number(line.cost_unit)*requested.quantity*100)/100;
   creditLines.push({...line,quantity:requested.quantity,subtotal,tax,total:subtotal+tax,costTotal});
  }
  const subtotal=Math.round(creditLines.reduce((s,l)=>s+l.subtotal,0)*100)/100;
  const tax=Math.round(creditLines.reduce((s,l)=>s+l.tax,0)*100)/100;
  const total=Math.round((subtotal+tax)*100)/100;
  if(total<=0)throw new Error("CREDIT_NOTE_ZERO");
  const n=await db.query("select nextval('sales_credit_note_number_seq') n");
  const number="SCN-"+new Date().getFullYear()+"-"+String(n.rows[0].n).padStart(7,"0");
  const note=await db.query(`insert into sales_credit_notes(credit_note_number,original_invoice_id,party_id,credit_date,subtotal,tax_amount,total,created_by)
   values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[number,inv.id,inv.party_id,p.data.credit_date,subtotal,tax,total,req.user.sub]);
  for(const l of creditLines)await db.query(`insert into sales_credit_note_lines(credit_note_id,original_invoice_line_id,item_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total,cost_total)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[note.rows[0].id,l.id,l.item_id,l.description,l.quantity,l.unit_price,l.tax_rate,l.subtotal,l.tax,l.total,l.costTotal]);
  await db.query("commit");await audit(req.user.sub,"finance.sales_credit_note_created","sales_credit_note",note.rows[0].id,{credit_note_number:number,total});
  res.status(201).json({credit_note:note.rows[0]});
 }catch(e){await db.query("rollback");const messages={ORIGINAL_INVOICE_INVALID:"الفاتورة الأصلية غير موجودة أو غير صادرة",ORIGINAL_LINE_INVALID:"أحد البنود لا يتبع الفاتورة الأصلية",RETURN_QUANTITY_EXCEEDED:"كمية المرتجع تتجاوز الكمية المباعة بعد احتساب المرتجعات السابقة",CREDIT_NOTE_ZERO:"قيمة الإشعار الدائن يجب أن تكون أكبر من صفر"};const msg=messages[e.message];if(!msg)console.error("sales credit note create failed",e.message);res.status(msg?400:500).json({error:msg||"تعذر إنشاء الإشعار الدائن"});}
 finally{db.release();}
});
app.post("/api/finance/sales-credit-notes/:id/post",auth,financeManager,async(req,res)=>{
 const db=await pool.connect();
 try{
  await db.query("begin");
  const cr=await db.query("select * from sales_credit_notes where id=$1 for update",[req.params.id]);
  if(!cr.rowCount||cr.rows[0].status!=="draft")throw new Error("CREDIT_NOTE_NOT_DRAFT");
  const note=cr.rows[0];
  const ir=await db.query("select * from sales_invoices where id=$1 for update",[note.original_invoice_id]);
  if(!ir.rowCount||!["issued","partially_paid","paid"].includes(ir.rows[0].status))throw new Error("ORIGINAL_INVOICE_INVALID");
  const inv=ir.rows[0],lines=await db.query("select * from sales_credit_note_lines where credit_note_id=$1",[note.id]);
  const stockLines=lines.rows.filter(l=>l.item_id);
  if(stockLines.length&&(!inv.cogs_account_id||!inv.inventory_account_id))throw new Error("ORIGINAL_COST_ACCOUNTS_MISSING");
  if(stockLines.some(line=>line.cost_total===null||line.cost_total===undefined))throw new Error("RETURN_COST_UNAVAILABLE");
  let returnedCost=0;
  for(const line of lines.rows){
   const returned=await db.query(`select coalesce(sum(cl.quantity),0)::numeric(14,3) quantity
    from sales_credit_note_lines cl join sales_credit_notes cn on cn.id=cl.credit_note_id
    where cl.original_invoice_line_id=$1 and cn.status='issued'`,[line.original_invoice_line_id]);
   const original=await db.query("select quantity from sales_invoice_lines where id=$1",[line.original_invoice_line_id]);
   if(!original.rowCount||Number(returned.rows[0].quantity)+Number(line.quantity)>Number(original.rows[0].quantity)+0.0005)throw new Error("RETURN_QUANTITY_EXCEEDED");
  }
  let stockDoc=null;
  if(stockLines.length){
   if(!inv.warehouse_id)throw new Error("RETURN_WAREHOUSE_REQUIRED");
   const wh=await db.query("select id from warehouses where id=$1 and is_active=true",[inv.warehouse_id]);
   if(!wh.rowCount)throw new Error("RETURN_WAREHOUSE_REQUIRED");
   const sd=await db.query(`insert into stock_documents(document_number,document_type,status,destination_warehouse_id,reference_number,notes,created_by,posted_by,posted_at)
    values('SCN-'||lpad(nextval('stock_document_number_seq')::text,8,'0'),'receipt','posted',$1,$2,'استلام مرتجع مبيعات',$3,$3,now()) returning id,document_number`,
    [inv.warehouse_id,note.credit_note_number,req.user.sub]);
   stockDoc=sd.rows[0];
   for(const line of stockLines){
    const costUnit=Number(line.cost_total)/Number(line.quantity);
    returnedCost=Math.round((returnedCost+Number(line.cost_total))*100)/100;
    await db.query("insert into stock_document_lines(document_id,item_id,quantity,unit_cost) values($1,$2,$3,$4)",[stockDoc.id,line.item_id,line.quantity,costUnit]);
    await db.query(`insert into stock_balances(warehouse_id,item_id,quantity) values($1,$2,$3)
     on conflict(warehouse_id,item_id) do update set quantity=stock_balances.quantity+excluded.quantity,updated_at=now()`,[inv.warehouse_id,line.item_id,line.quantity]);
   }
  }
  if(!inv.receivable_account_id||!inv.revenue_account_id||!inv.output_tax_account_id)throw new Error("ORIGINAL_ACCOUNTS_MISSING");
  const paid=await db.query("select coalesce(sum(amount),0)::numeric(16,2) amount from sales_receipt_allocations where invoice_id=$1",[inv.id]);
  const priorCredits=await db.query("select coalesce(sum(total),0)::numeric(16,2) amount from sales_credit_notes where original_invoice_id=$1 and status='issued' and id<>$2",[inv.id,note.id]);
  const outstanding=Math.max(0,Math.round((Number(inv.total)-Number(paid.rows[0].amount)-Number(priorCredits.rows[0].amount))*100)/100);
  const arCredit=Math.min(Number(note.total),outstanding);
  const customerCredit=Math.round((Number(note.total)-arCredit)*100)/100;
  let customerCreditAccountId=null;
  if(customerCredit>0){
   const accountId=req.body.customer_credit_account_id;
   if(!accountId)throw new Error("CUSTOMER_CREDIT_ACCOUNT_REQUIRED");
   const account=await db.query("select id,account_type from finance_accounts where id=$1 and is_active=true",[accountId]);
   if(!account.rowCount||account.rows[0].account_type!=="liability")throw new Error("CUSTOMER_CREDIT_ACCOUNT_INVALID");
   customerCreditAccountId=accountId;
  }
  const je=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),$1,$2,'posted','sales_credit_note',$3,$4,$4,now()) returning id,entry_number`,
   [note.credit_date,"إشعار دائن "+note.credit_note_number+" للفاتورة "+inv.invoice_number,note.id,req.user.sub]);
  if(Number(note.subtotal)>0)await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,$5,0)",[je.rows[0].id,inv.revenue_account_id,inv.party_id,"عكس إيراد مرتجع "+note.credit_note_number,note.subtotal]);
  if(Number(note.tax_amount)>0)await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,$5,0)",[je.rows[0].id,inv.output_tax_account_id,inv.party_id,"عكس ضريبة مرتجع "+note.credit_note_number,note.tax_amount]);
  if(arCredit>0)await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,0,$5)",[je.rows[0].id,inv.receivable_account_id,inv.party_id,"تخفيض ذمم العميل "+note.credit_note_number,arCredit]);
  if(customerCredit>0)await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,0,$5)",[je.rows[0].id,customerCreditAccountId,inv.party_id,"رصيد دائن للعميل "+note.credit_note_number,customerCredit]);
  if(returnedCost>0){
   await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,0)",[je.rows[0].id,inv.inventory_account_id,"إعادة تكلفة المخزون "+note.credit_note_number,returnedCost]);
   await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[je.rows[0].id,inv.cogs_account_id,"عكس تكلفة البضاعة المباعة "+note.credit_note_number,returnedCost]);
  }
  await db.query("update sales_credit_notes set status='issued',journal_entry_id=$1,stock_document_id=$2,posted_by=$3,posted_at=now(),customer_credit_amount=$4,customer_credit_account_id=$5 where id=$6",[je.rows[0].id,stockDoc?.id||null,req.user.sub,customerCredit,customerCreditAccountId,note.id]);
  await db.query("commit");await audit(req.user.sub,"finance.sales_credit_note_posted","sales_credit_note",note.id,{journal_entry_id:je.rows[0].id,stock_document_id:stockDoc?.id||null,total:note.total});
  res.json({status:"issued",journal:je.rows[0],stock_document:stockDoc});
 }catch(e){await db.query("rollback");const messages={CREDIT_NOTE_NOT_DRAFT:"الإشعار الدائن غير موجود أو سبق ترحيله",ORIGINAL_INVOICE_INVALID:"الفاتورة الأصلية غير صالحة",RETURN_QUANTITY_EXCEEDED:"كمية المرتجع تتجاوز الكمية المتاحة للإرجاع",RETURN_WAREHOUSE_REQUIRED:"مستودع الفاتورة الأصلية غير متاح لاستلام المرتجع",ORIGINAL_ACCOUNTS_MISSING:"الفاتورة الأصلية لا تحتوي حسابات محاسبية مكتملة",ORIGINAL_COST_ACCOUNTS_MISSING:"الفاتورة الأصلية لا تحتوي حسابات المخزون والتكلفة",RETURN_COST_UNAVAILABLE:"تعذر ترحيل المرتجع لأن تكلفة الصنف التاريخية غير محفوظة في الفاتورة الأصلية",CUSTOMER_CREDIT_ACCOUNT_REQUIRED:"اختر حساب التزامات أرصدة العملاء الدائنة",CUSTOMER_CREDIT_ACCOUNT_INVALID:"حساب رصيد العميل الدائن يجب أن يكون حساب التزامات نشطاً"};const msg=messages[e.message];if(!msg)console.error("sales credit note posting failed",e.message);res.status(msg?400:500).json({error:msg||"تعذر ترحيل الإشعار الدائن"});}
 finally{db.release();}
});

app.post("/api/finance/customer-refunds",auth,financeManager,async(req,res)=>{
 const p=z.object({credit_note_id:z.string().uuid(),amount:z.coerce.number().positive().max(999999999),payment_method:z.enum(["cash","bank_transfer","card","other"]),payment_account_id:z.string().uuid(),reference_number:z.string().max(100).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من الإشعار الدائن والمبلغ وحساب الصندوق أو البنك"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const cr=await db.query("select * from sales_credit_notes where id=$1 for update",[p.data.credit_note_id]);
  if(!cr.rowCount||cr.rows[0].status!=="issued")throw new Error("CREDIT_NOTE_UNAVAILABLE");
  const note=cr.rows[0];
  if(!note.customer_credit_account_id||Number(note.customer_credit_amount)<=0)throw new Error("NO_REFUNDABLE_CREDIT");
  const refunded=await db.query("select coalesce(sum(amount),0)::numeric(16,2) amount from sales_credit_note_refunds where credit_note_id=$1",[note.id]);
  const remaining=Math.round((Number(note.customer_credit_amount)-Number(refunded.rows[0].amount))*100)/100;
  const amount=Math.round(p.data.amount*100)/100;
  if(amount<=0||amount>remaining+0.001)throw new Error("REFUND_EXCEEDS_CREDIT");
  const accounts=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[[p.data.payment_account_id,note.customer_credit_account_id]]);
  const types=new Map(accounts.rows.map(x=>[x.id,x.account_type]));
  if(accounts.rowCount!==2||types.get(p.data.payment_account_id)!=="asset"||types.get(note.customer_credit_account_id)!=="liability"||p.data.payment_account_id===note.customer_credit_account_id)throw new Error("REFUND_ACCOUNT_TYPES");
  const n=await db.query("select nextval('customer_refund_number_seq') n");
  const refundNumber="CRF-"+new Date().getFullYear()+"-"+String(n.rows[0].n).padStart(7,"0");
  const je=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),current_date,$1,'posted','customer_refund',$2,$3,$3,now()) returning id,entry_number`,
   ["استرداد مبلغ للعميل "+note.credit_note_number,note.id,req.user.sub]);
  await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,$5,0)",[je.rows[0].id,note.customer_credit_account_id,note.party_id,"تسوية رصيد دائن "+refundNumber,amount]);
  await db.query("insert into journal_lines(entry_id,account_id,party_id,description,debit,credit) values($1,$2,$3,$4,0,$5)",[je.rows[0].id,p.data.payment_account_id,note.party_id,"صرف استرداد "+refundNumber,amount]);
  const rr=await db.query(`insert into sales_credit_note_refunds(refund_number,credit_note_id,amount,payment_method,payment_account_id,reference_number,journal_entry_id,created_by)
   values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
   [refundNumber,note.id,amount,p.data.payment_method,p.data.payment_account_id,p.data.reference_number||null,je.rows[0].id,req.user.sub]);
  await db.query("commit");
  await audit(req.user.sub,"finance.customer_refund_created","sales_credit_note_refund",rr.rows[0].id,{refund_number:refundNumber,credit_note_id:note.id,amount});
  res.status(201).json({refund:rr.rows[0],journal:je.rows[0],remaining:Math.max(0,remaining-amount)});
 }catch(e){
  await db.query("rollback");
  const messages={CREDIT_NOTE_UNAVAILABLE:"الإشعار الدائن غير موجود أو غير مرحّل",NO_REFUNDABLE_CREDIT:"لا يوجد رصيد دائن قابل للاسترداد لهذا الإشعار",REFUND_EXCEEDS_CREDIT:"مبلغ الاسترداد يتجاوز رصيد العميل الدائن المتاح",REFUND_ACCOUNT_TYPES:"اختر حساب التزامات الرصيد الدائن وحساب صندوق أو بنك نشطين ومختلفين"};
  const msg=messages[e.message];if(!msg)console.error("customer refund failed",e.message);
  res.status(msg?400:500).json({error:msg||"تعذر تسجيل استرداد العميل"});
 }finally{db.release();}
});

app.get("/api/finance/parties/:id/statement",auth,async(req,res)=>{
 const query=z.object({from:z.string().date().optional(),to:z.string().date().optional()}).refine(v=>!v.from||!v.to||v.from<=v.to).safeParse(req.query);
 if(!query.success)return res.status(400).json({error:"نطاق تاريخ كشف الحساب غير صالح"});
 try{
  const party=await pool.query("select id,name,party_type from finance_parties where id=$1",[req.params.id]);
  if(!party.rowCount||!["customer","both"].includes(party.rows[0].party_type))return res.status(404).json({error:"العميل غير موجود"});
  const from=query.data.from||"1900-01-01",to=query.data.to||"2999-12-31";
  const opening=await pool.query(`
   select coalesce(sum(x.debit-x.credit),0)::numeric(16,2) as balance from (
    select i.total as debit,0::numeric as credit from sales_invoices i
     where i.party_id=$1 and i.status in ('issued','partially_paid','paid') and i.issue_date<$2::date
    union all
    select 0::numeric,a.amount as credit from sales_receipt_allocations a
     join sales_invoices i on i.id=a.invoice_id join finance_receipts r on r.id=a.receipt_id
     where i.party_id=$1 and i.status in ('issued','partially_paid','paid') and r.received_at<$2::date
    union all
    select 0::numeric as debit,c.total as credit from sales_credit_notes c
     where c.party_id=$1 and c.status='issued' and c.credit_date<$2::date
   ) x`,[req.params.id,from]);
  const rows=await pool.query(`
   select * from (
    select i.id,'invoice'::text as transaction_type,i.invoice_number as reference,i.issue_date::date as transaction_date,
     ('فاتورة مبيعات '||i.invoice_number)::text as description,i.total::numeric(16,2) as debit,0::numeric(16,2) as credit
    from sales_invoices i where i.party_id=$1 and i.status in ('issued','partially_paid','paid') and i.issue_date between $2::date and $3::date
    union all
    select a.id,'receipt'::text,r.receipt_number,r.received_at::date,('سند قبض '||r.receipt_number)::text,
     0::numeric(16,2),a.amount::numeric(16,2)
    from sales_receipt_allocations a
    join finance_receipts r on r.id=a.receipt_id
    join sales_invoices i on i.id=a.invoice_id
    where i.party_id=$1 and i.status in ('issued','partially_paid','paid') and r.received_at::date between $2::date and $3::date
    union all
    select c.id,'credit_note'::text,c.credit_note_number,c.credit_date,('إشعار دائن '||c.credit_note_number)::text,
     0::numeric(16,2),c.total::numeric(16,2)
    from sales_credit_notes c where c.party_id=$1 and c.status='issued' and c.credit_date between $2::date and $3::date
   ) ledger order by transaction_date,transaction_type,reference`,[req.params.id,from,to]);
  let balance=Number(opening.rows[0].balance);
  const transactions=rows.rows.map(row=>{balance=Math.round((balance+Number(row.debit)-Number(row.credit))*100)/100;return {...row,running_balance:balance};});
  res.json({party:party.rows[0],period:{from,to},opening_balance:opening.rows[0].balance,closing_balance:balance,transactions});
 }catch(e){console.error("customer statement failed",e.message);res.status(503).json({error:"تعذر إعداد كشف حساب العميل"});}
});


const enterpriseManager=(req,res,next)=>["admin","manager"].includes(req.user.role)?next():res.status(403).json({error:"هذه العملية متاحة للمدير ومدير النظام"});
app.get("/api/crm/leads",auth,async(_req,res)=>{try{const r=await pool.query("select * from crm_leads order by created_at desc limit 300");res.json({leads:r.rows});}catch(e){res.status(503).json({error:"تعذر تحميل العملاء المحتملين"});}});
app.post("/api/crm/leads",auth,async(req,res)=>{const p=z.object({company_name:z.string().trim().min(2).max(180),contact_name:z.string().max(160).optional(),email:z.string().email().max(254).optional().or(z.literal("")),phone:z.string().max(40).optional(),source:z.string().max(60).optional(),estimated_value:z.coerce.number().min(0).max(999999999).default(0),notes:z.string().max(4000).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من بيانات العميل المحتمل"});try{const r=await pool.query("insert into crm_leads(lead_number,company_name,contact_name,email,phone,source,estimated_value,notes,created_by) values('LEAD-'||lpad(nextval('crm_lead_number_seq')::text,6,'0'),$1,$2,$3,$4,$5,$6,$7,$8) returning *",[p.data.company_name,p.data.contact_name||null,p.data.email||null,p.data.phone||null,p.data.source||null,p.data.estimated_value,p.data.notes||null,req.user.sub]);await audit(req.user.sub,"crm.lead_created","crm_lead",r.rows[0].id);res.status(201).json({lead:r.rows[0]});}catch(e){res.status(500).json({error:"تعذر حفظ العميل المحتمل"});}});
app.patch("/api/crm/leads/:id/status",auth,enterpriseManager,async(req,res)=>{const p=z.object({status:z.enum(["new","qualified","proposal","won","lost"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"الحالة غير صالحة"});const r=await pool.query("update crm_leads set status=$1,updated_at=now() where id=$2 returning *",[p.data.status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"العميل المحتمل غير موجود"});await audit(req.user.sub,"crm.lead_status_changed","crm_lead",req.params.id,{status:p.data.status});res.json({lead:r.rows[0]});});
app.get("/api/crm/activities",auth,async(_req,res)=>{const r=await pool.query("select a.*,l.company_name from crm_activities a left join crm_leads l on l.id=a.lead_id order by coalesce(a.due_at,a.created_at) desc limit 300");res.json({activities:r.rows});});
app.post("/api/crm/activities",auth,async(req,res)=>{const p=z.object({lead_id:z.string().uuid().optional(),activity_type:z.enum(["call","meeting","email","task","note"]),subject:z.string().trim().min(2).max(200),details:z.string().max(4000).optional(),due_at:z.string().datetime().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"بيانات النشاط غير صالحة"});try{const r=await pool.query("insert into crm_activities(lead_id,activity_type,subject,details,due_at,created_by) values($1,$2,$3,$4,$5,$6) returning *",[p.data.lead_id||null,p.data.activity_type,p.data.subject,p.data.details||null,p.data.due_at||null,req.user.sub]);res.status(201).json({activity:r.rows[0]});}catch(e){res.status(500).json({error:"تعذر حفظ النشاط"});}});
// Procurement requests and approval
app.get("/api/procurement/requests",auth,async(req,res)=>{const manager=["admin","manager"].includes(req.user.role);const r=await pool.query("select p.*,u.full_name as requester_name from purchase_requests p left join users u on u.id=p.requested_by "+(manager?"":"where p.requested_by=$1 ")+"order by p.created_at desc limit 300",manager?[]:[req.user.sub]);res.json({requests:r.rows});});
app.post("/api/procurement/requests",auth,async(req,res)=>{const p=z.object({department:z.string().max(120).optional(),purpose:z.string().trim().min(3).max(2000),required_date:z.string().date().optional(),lines:z.array(z.object({item_id:z.string().uuid().optional(),description:z.string().trim().min(2).max(500),quantity:z.coerce.number().positive().max(1000000),estimated_unit_price:z.coerce.number().min(0).max(999999999).default(0)})).min(1).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من بيانات طلب الشراء وبنوده"});const db=await pool.connect();try{await db.query("begin");const q=await db.query("insert into purchase_requests(request_number,requested_by,department,purpose,required_date) values('PR-'||lpad(nextval('purchase_request_number_seq')::text,6,'0'),$1,$2,$3,$4) returning *",[req.user.sub,p.data.department||null,p.data.purpose,p.data.required_date||null]);for(const l of p.data.lines)await db.query("insert into purchase_request_lines(request_id,item_id,description,quantity,estimated_unit_price) values($1,$2,$3,$4,$5)",[q.rows[0].id,l.item_id||null,l.description,l.quantity,l.estimated_unit_price]);await db.query("commit");await audit(req.user.sub,"procurement.request_created","purchase_request",q.rows[0].id);res.status(201).json({request:q.rows[0]});}catch(e){await db.query("rollback");res.status(500).json({error:"تعذر إنشاء طلب الشراء"});}finally{db.release();}});
app.patch("/api/procurement/requests/:id/decision",auth,enterpriseManager,async(req,res)=>{const p=z.object({status:z.enum(["approved","rejected"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"قرار الطلب غير صالح"});const r=await pool.query("update purchase_requests set status=$1,approved_by=$2,approved_at=now() where id=$3 and status='pending' returning *",[p.data.status,req.user.sub,req.params.id]);if(!r.rowCount)return res.status(409).json({error:"الطلب غير موجود أو سبق اتخاذ قرار فيه"});await audit(req.user.sub,"procurement.request_"+p.data.status,"purchase_request",req.params.id);res.json({request:r.rows[0]});});
// Purchase orders and goods receipts: receiving posts stock and PO quantities atomically.
app.get("/api/procurement/orders",auth,enterpriseManager,async(_req,res)=>{
 try{
  const r=await pool.query(`select o.*,p.name as supplier_display_name,
    coalesce(json_agg(json_build_object('id',l.id,'item_id',l.item_id,'description',l.description,'quantity',l.quantity,'received_quantity',l.received_quantity,'unit_price',l.unit_price,'tax_rate',l.tax_rate) order by l.description) filter(where l.id is not null),'[]'::json) as lines
    from purchase_orders o left join finance_parties p on p.id=o.supplier_id
    left join purchase_order_lines l on l.order_id=o.id
    group by o.id,p.name order by o.order_date desc,o.created_at desc limit 300`);
  res.json({orders:r.rows});
 }catch(error){console.error("purchase orders list failed",error.message);res.status(503).json({error:"تعذر تحميل أوامر الشراء"});}
});
app.post("/api/procurement/orders",auth,enterpriseManager,async(req,res)=>{
 const p=z.object({
  request_id:z.string().uuid().optional(),supplier_id:z.string().uuid(),
  expected_date:z.string().date().optional(),notes:z.string().max(3000).optional(),
  lines:z.array(z.object({item_id:z.string().uuid().optional(),description:z.string().trim().min(2).max(500),quantity:z.coerce.number().positive().max(1000000),unit_price:z.coerce.number().min(0).max(999999999),tax_rate:z.coerce.number().min(0).max(100).default(15)})).min(1).max(100)
 }).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من المورد وبنود أمر الشراء"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const supplier=await db.query("select id from finance_parties where id=$1 and party_type in ('supplier','both')",[p.data.supplier_id]);
  if(!supplier.rowCount)throw new Error("SUPPLIER_INVALID");
  if(p.data.request_id){
   const request=await db.query("select status from purchase_requests where id=$1 for update",[p.data.request_id]);
   if(!request.rowCount||request.rows[0].status!=="approved")throw new Error("REQUEST_NOT_APPROVED");
  }
  const subtotal=p.data.lines.reduce((s,l)=>s+l.quantity*l.unit_price,0);
  const tax=p.data.lines.reduce((s,l)=>s+l.quantity*l.unit_price*l.tax_rate/100,0);
  const order=await db.query(`insert into purchase_orders(order_number,request_id,supplier_id,supplier_name,expected_date,status,subtotal,tax_amount,total,notes,created_by)
   values('PO-'||lpad(nextval('purchase_order_number_seq')::text,6,'0'),$1,$2,(select name from finance_parties where id=$2),$3,'sent',$4,$5,$6,$7,$8) returning *`,
   [p.data.request_id||null,p.data.supplier_id,p.data.expected_date||null,subtotal,tax,subtotal+tax,p.data.notes||null,req.user.sub]);
  for(const line of p.data.lines)await db.query("insert into purchase_order_lines(order_id,item_id,description,quantity,unit_price,tax_rate) values($1,$2,$3,$4,$5,$6)",[order.rows[0].id,line.item_id||null,line.description,line.quantity,line.unit_price,line.tax_rate]);
  if(p.data.request_id)await db.query("update purchase_requests set status='ordered' where id=$1",[p.data.request_id]);
  await db.query("commit");
  await audit(req.user.sub,"procurement.order_created","purchase_order",order.rows[0].id,{order_number:order.rows[0].order_number});
  res.status(201).json({order:order.rows[0]});
 }catch(error){
  await db.query("rollback");
  const known=error.message==="SUPPLIER_INVALID"?"المورد غير موجود أو ليس مورداً":error.message==="REQUEST_NOT_APPROVED"?"يجب اعتماد طلب الشراء قبل إصدار الأمر":null;
  res.status(known?400:500).json({error:known||"تعذر إنشاء أمر الشراء"});
 }finally{db.release();}
});
app.post("/api/procurement/orders/:id/receive",auth,enterpriseManager,async(req,res)=>{
 const p=z.object({
  warehouse_id:z.string().uuid(),notes:z.string().max(2000).optional(),
  lines:z.array(z.object({order_line_id:z.string().uuid(),quantity:z.coerce.number().positive().max(1000000),unit_cost:z.coerce.number().min(0).max(999999999).optional()})).min(1).max(100)
 }).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من المستودع وكميات الاستلام"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const order=await db.query("select * from purchase_orders where id=$1 for update",[req.params.id]);
  if(!order.rowCount||!["sent","partially_received"].includes(order.rows[0].status))throw new Error("ORDER_NOT_RECEIVABLE");
  const wh=await db.query("select id from warehouses where id=$1 and is_active=true",[p.data.warehouse_id]);
  if(!wh.rowCount)throw new Error("WAREHOUSE_INVALID");
  const ids=p.data.lines.map(x=>x.order_line_id);
  if(new Set(ids).size!==ids.length)throw new Error("DUPLICATE_LINE");
  const found=await db.query("select * from purchase_order_lines where order_id=$1 and id=any($2::uuid[]) for update",[req.params.id,ids]);
  if(found.rowCount!==ids.length)throw new Error("LINE_INVALID");
  const byId=new Map(found.rows.map(x=>[x.id,x]));
  for(const line of p.data.lines){
   const poLine=byId.get(line.order_line_id);
   if(!poLine.item_id)throw new Error("ITEM_REQUIRED");
   if(Number(poLine.received_quantity)+line.quantity>Number(poLine.quantity)+0.000001)throw new Error("OVER_RECEIVE");
  }
  const stock=await db.query(`insert into stock_documents(document_number,document_type,status,destination_warehouse_id,reference_number,notes,created_by,posted_by,posted_at)
   values('GR-'||lpad(nextval('stock_document_number_seq')::text,8,'0'),'receipt','posted',$1,$2,$3,$4,$4,now()) returning id,document_number`,
   [p.data.warehouse_id,order.rows[0].order_number,p.data.notes||null,req.user.sub]);
  const receipt=await db.query(`insert into goods_receipts(receipt_number,purchase_order_id,warehouse_id,stock_document_id,received_by,notes)
   values('GRN-'||lpad(nextval('goods_receipt_number_seq')::text,6,'0'),$1,$2,$3,$4,$5) returning *`,
   [req.params.id,p.data.warehouse_id,stock.rows[0].id,req.user.sub,p.data.notes||null]);
  for(const line of p.data.lines){
   const poLine=byId.get(line.order_line_id),cost=line.unit_cost??Number(poLine.unit_price);
   await db.query("insert into stock_document_lines(document_id,item_id,quantity,unit_cost) values($1,$2,$3,$4)",[stock.rows[0].id,poLine.item_id,line.quantity,cost]);
   await db.query("insert into goods_receipt_lines(receipt_id,purchase_order_line_id,item_id,quantity,unit_cost) values($1,$2,$3,$4,$5)",[receipt.rows[0].id,poLine.id,poLine.item_id,line.quantity,cost]);
   await db.query("update purchase_order_lines set received_quantity=received_quantity+$1 where id=$2",[line.quantity,poLine.id]);
   await db.query("insert into stock_balances(warehouse_id,item_id,quantity) values($1,$2,$3) on conflict(warehouse_id,item_id) do update set quantity=stock_balances.quantity+excluded.quantity,updated_at=now()",[p.data.warehouse_id,poLine.item_id,line.quantity]);
  }
  const remaining=await db.query("select count(*)::int as n from purchase_order_lines where order_id=$1 and received_quantity<quantity",[req.params.id]);
  const receivedStatus=Number(remaining.rows[0].n)===0?"received":"partially_received";
  await db.query("update purchase_orders set status=$1 where id=$2",[receivedStatus,req.params.id]);
  await db.query("commit");
  await audit(req.user.sub,"procurement.goods_received","goods_receipt",receipt.rows[0].id,{purchase_order_id:req.params.id,stock_document_id:stock.rows[0].id});
  res.status(201).json({receipt:receipt.rows[0],stock_document:stock.rows[0],order_status:receivedStatus});
 }catch(error){
  await db.query("rollback");
  const messages={ORDER_NOT_RECEIVABLE:"أمر الشراء غير موجود أو لا يقبل الاستلام حالياً",WAREHOUSE_INVALID:"المستودع غير موجود أو غير نشط",DUPLICATE_LINE:"لا تكرر بند أمر الشراء في الاستلام",LINE_INVALID:"يوجد بند لا يتبع أمر الشراء",ITEM_REQUIRED:"اربط بند أمر الشراء بصنف مخزني قبل الاستلام",OVER_RECEIVE:"كمية الاستلام تتجاوز الكمية المتبقية في أمر الشراء"};
  const known=messages[error.message];
  if(!known)console.error("goods receipt failed",error.message);
  res.status(known?400:500).json({error:known||"تعذر تسجيل استلام البضاعة"});
 }finally{db.release();}
});
app.get("/api/procurement/goods-receipts",auth,enterpriseManager,async(_req,res)=>{
 try{const r=await pool.query(`select g.*,o.order_number,w.name as warehouse_name,u.full_name as receiver_name
  from goods_receipts g join purchase_orders o on o.id=g.purchase_order_id join warehouses w on w.id=g.warehouse_id
  left join users u on u.id=g.received_by order by g.received_at desc limit 300`);res.json({receipts:r.rows});}
 catch(error){res.status(503).json({error:"تعذر تحميل سندات الاستلام"});}
});

// Supplier invoices: match billed quantities to received PO quantities and post balanced AP journals.
app.get("/api/procurement/supplier-invoices",auth,enterpriseManager,async(_req,res)=>{
 try{
  const r=await pool.query(`select i.*,p.name as supplier_name,o.order_number,j.entry_number,
   coalesce(pay.paid_amount,0)::numeric(16,2) paid_amount,
   greatest(0,i.total-coalesce(pay.paid_amount,0))::numeric(16,2) outstanding_amount
   from supplier_invoices i join finance_parties p on p.id=i.supplier_id
   join purchase_orders o on o.id=i.purchase_order_id
   left join journal_entries j on j.id=i.journal_entry_id
   left join lateral (select sum(amount) paid_amount from supplier_invoice_payments where supplier_invoice_id=i.id) pay on true
   order by i.invoice_date desc,i.created_at desc limit 300`);
  res.json({invoices:r.rows});
 }catch(error){console.error("supplier invoices list failed",error.message);res.status(503).json({error:"تعذر تحميل فواتير الموردين"});}
});
app.post("/api/procurement/supplier-invoices",auth,enterpriseManager,async(req,res)=>{
 const p=z.object({
  purchase_order_id:z.string().uuid(),supplier_invoice_number:z.string().trim().min(1).max(100),
  invoice_date:z.string().date(),due_date:z.string().date().optional(),notes:z.string().max(3000).optional(),
  lines:z.array(z.object({purchase_order_line_id:z.string().uuid(),quantity:z.coerce.number().positive().max(1000000),unit_price:z.coerce.number().min(0).max(999999999),tax_rate:z.coerce.number().min(0).max(100).default(15)})).min(1).max(100)
 }).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من رقم الفاتورة والتاريخ وبنودها"});
 if(new Set(p.data.lines.map(x=>x.purchase_order_line_id)).size!==p.data.lines.length)return res.status(400).json({error:"لا تكرر بند أمر الشراء في الفاتورة"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const order=await db.query("select id,supplier_id,status from purchase_orders where id=$1 for update",[p.data.purchase_order_id]);
  if(!order.rowCount||!["partially_received","received"].includes(order.rows[0].status))throw new Error("ORDER_NOT_RECEIVED");
  const lineIds=p.data.lines.map(x=>x.purchase_order_line_id);
  const poLines=await db.query("select * from purchase_order_lines where order_id=$1 and id=any($2::uuid[]) order by id for update",[p.data.purchase_order_id,lineIds]);
  if(poLines.rowCount!==lineIds.length)throw new Error("PO_LINE_INVALID");
  const byId=new Map(poLines.rows.map(x=>[x.id,x]));
  for(const line of p.data.lines){
   const poLine=byId.get(line.purchase_order_line_id);
   const billed=await db.query(`select coalesce(sum(l.quantity),0)::numeric as quantity
    from supplier_invoice_lines l join supplier_invoices i on i.id=l.invoice_id
    where l.purchase_order_line_id=$1 and i.status<>'cancelled'`,[poLine.id]);
   const remaining=Number(poLine.received_quantity)-Number(billed.rows[0].quantity);
   if(line.quantity>remaining+0.000001)throw new Error("BILL_EXCEEDS_RECEIVED");
  }
  const calculated=p.data.lines.map(line=>{
   const sub=Math.round(line.quantity*line.unit_price*100)/100;
   const tax=Math.round(sub*line.tax_rate)/100;
   return {...line,subtotal:sub,tax,lineTotal:sub+tax,description:byId.get(line.purchase_order_line_id).description};
  });
  const subtotal=Math.round(calculated.reduce((a,l)=>a+l.subtotal,0)*100)/100;
  const taxAmount=Math.round(calculated.reduce((a,l)=>a+l.tax,0)*100)/100;
  const total=Math.round((subtotal+taxAmount)*100)/100;
  const invoice=await db.query(`insert into supplier_invoices(internal_number,supplier_invoice_number,supplier_id,purchase_order_id,invoice_date,due_date,status,subtotal,tax_amount,total,notes,created_by)
   values('PINV-'||lpad(nextval('supplier_invoice_number_seq')::text,7,'0'),$1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10) returning *`,
   [p.data.supplier_invoice_number,order.rows[0].supplier_id,p.data.purchase_order_id,p.data.invoice_date,p.data.due_date||null,subtotal,taxAmount,total,p.data.notes||null,req.user.sub]);
  for(const line of calculated)await db.query(`insert into supplier_invoice_lines(invoice_id,purchase_order_line_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[invoice.rows[0].id,line.purchase_order_line_id,line.description,line.quantity,line.unit_price,line.tax_rate,line.subtotal,line.tax,line.lineTotal]);
  await db.query("commit");
  await audit(req.user.sub,"procurement.supplier_invoice_created","supplier_invoice",invoice.rows[0].id,{purchase_order_id:p.data.purchase_order_id,total});
  res.status(201).json({invoice:invoice.rows[0]});
 }catch(error){
  await db.query("rollback");
  const messages={ORDER_NOT_RECEIVED:"لا يمكن تسجيل فاتورة قبل استلام جزء من أمر الشراء على الأقل",PO_LINE_INVALID:"يوجد بند لا يتبع أمر الشراء",BILL_EXCEEDS_RECEIVED:"كمية الفاتورة تتجاوز الكمية المستلمة غير المفوترة"};
  const known=messages[error.message];
  if(!known)console.error("supplier invoice create failed",error.message);
  res.status(known?400:error.code==="23505"?409:500).json({error:known||(error.code==="23505"?"رقم فاتورة المورد مسجل مسبقاً":"تعذر تسجيل فاتورة المورد")});
 }finally{db.release();}
});
app.post("/api/procurement/supplier-invoices/:id/post",auth,enterpriseManager,async(req,res)=>{
 const p=z.object({payable_account_id:z.string().uuid(),inventory_account_id:z.string().uuid(),input_tax_account_id:z.string().uuid()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"حدد حساب الدائنين والمخزون وضريبة المدخلات"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const invoice=await db.query("select * from supplier_invoices where id=$1 for update",[req.params.id]);
  if(!invoice.rowCount||invoice.rows[0].status!=="draft")throw new Error("INVOICE_NOT_DRAFT");
  const ids=[p.data.payable_account_id,p.data.inventory_account_id,p.data.input_tax_account_id];
  if(new Set(ids).size!==3)throw new Error("ACCOUNTS_MUST_DIFFER");
  const accounts=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[ids]);
  const types=new Map(accounts.rows.map(a=>[a.id,a.account_type]));
  if(accounts.rowCount!==3||types.get(p.data.payable_account_id)!=="liability"||types.get(p.data.inventory_account_id)!=="asset"||types.get(p.data.input_tax_account_id)!=="asset")throw new Error("ACCOUNT_TYPES_INVALID");
  const inv=invoice.rows[0];
  const journal=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),$1,$2,'posted','supplier_invoice',$3,$4,$4,now()) returning id,entry_number`,
   [inv.invoice_date,"فاتورة مورد "+inv.supplier_invoice_number,inv.id,req.user.sub]);
  if(Number(inv.subtotal)>0)await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,0)",[journal.rows[0].id,p.data.inventory_account_id,"قيمة المشتريات - "+inv.internal_number,inv.subtotal]);
  if(Number(inv.tax_amount)>0)await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,0)",[journal.rows[0].id,p.data.input_tax_account_id,"ضريبة مدخلات - "+inv.internal_number,inv.tax_amount]);
  await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[journal.rows[0].id,p.data.payable_account_id,"ذمم المورد - "+inv.internal_number,inv.total]);
  await db.query("update supplier_invoices set status='posted',payable_account_id=$1,inventory_account_id=$2,input_tax_account_id=$3,journal_entry_id=$4,posted_by=$5,posted_at=now() where id=$6",
   [p.data.payable_account_id,p.data.inventory_account_id,p.data.input_tax_account_id,journal.rows[0].id,req.user.sub,inv.id]);
  await db.query("commit");
  await audit(req.user.sub,"procurement.supplier_invoice_posted","supplier_invoice",inv.id,{journal_entry_id:journal.rows[0].id,total:inv.total});
  res.json({status:"posted",journal:journal.rows[0]});
 }catch(error){
  await db.query("rollback");
  const messages={INVOICE_NOT_DRAFT:"الفاتورة غير موجودة أو سبق ترحيلها",ACCOUNTS_MUST_DIFFER:"يجب اختيار ثلاثة حسابات مختلفة",ACCOUNT_TYPES_INVALID:"تحقق من أن الدائنين التزامات وأن المخزون وضريبة المدخلات أصول"};
  const known=messages[error.message];
  if(!known)console.error("supplier invoice posting failed",error.message);
  res.status(known?400:500).json({error:known||"تعذر ترحيل فاتورة المورد"});
 }finally{db.release();}
});

app.get("/api/procurement/supplier-payments",auth,enterpriseManager,async(_req,res)=>{
 try{
  const r=await pool.query(`select p.*,i.internal_number,i.supplier_invoice_number,f.name as supplier_name,j.entry_number,a.account_code,a.account_name
   from supplier_invoice_payments p join supplier_invoices i on i.id=p.supplier_invoice_id
   join finance_parties f on f.id=i.supplier_id left join journal_entries j on j.id=p.journal_entry_id
   left join finance_accounts a on a.id=p.payment_account_id order by p.paid_at desc limit 300`);
  res.json({payments:r.rows});
 }catch(e){console.error("supplier payments list failed",e.message);res.status(503).json({error:"تعذر تحميل دفعات الموردين"});}
});
app.post("/api/procurement/supplier-payments",auth,enterpriseManager,async(req,res)=>{
 const p=z.object({supplier_invoice_id:z.string().uuid(),amount:z.coerce.number().positive().max(999999999),payment_method:z.enum(["cash","bank_transfer","card","other"]),payment_account_id:z.string().uuid(),reference_number:z.string().max(100).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"تحقق من فاتورة المورد والمبلغ وحساب الدفع"});
 const db=await pool.connect();
 try{
  await db.query("begin");
  const ir=await db.query("select * from supplier_invoices where id=$1 for update",[p.data.supplier_invoice_id]);
  if(!ir.rowCount||ir.rows[0].status!=="posted")throw new Error("SUPPLIER_INVOICE_UNAVAILABLE");
  const inv=ir.rows[0];
  if(!inv.payable_account_id)throw new Error("PAYABLE_ACCOUNT_MISSING");
  const paid=await db.query("select coalesce(sum(amount),0)::numeric(16,2) amount from supplier_invoice_payments where supplier_invoice_id=$1",[inv.id]);
  const outstanding=Math.max(0,Math.round((Number(inv.total)-Number(paid.rows[0].amount))*100)/100);
  const amount=Math.round(p.data.amount*100)/100;
  if(amount<=0||amount>outstanding+0.001)throw new Error("PAYMENT_EXCEEDS_DUE");
  const accounts=await db.query("select id,account_type from finance_accounts where id=any($1::uuid[]) and is_active=true",[[p.data.payment_account_id,inv.payable_account_id]]);
  const types=new Map(accounts.rows.map(a=>[a.id,a.account_type]));
  if(accounts.rowCount!==2||types.get(p.data.payment_account_id)!=="asset"||types.get(inv.payable_account_id)!=="liability"||p.data.payment_account_id===inv.payable_account_id)throw new Error("PAYMENT_ACCOUNT_TYPES");
  const n=await db.query("select nextval('supplier_payment_number_seq') n");
  const paymentNumber="SPAY-"+new Date().getFullYear()+"-"+String(n.rows[0].n).padStart(7,"0");
  const journal=await db.query(`insert into journal_entries(entry_number,entry_date,description,status,source_type,source_id,created_by,posted_by,posted_at)
   values('JE-'||lpad(nextval('journal_number_seq')::text,8,'0'),current_date,$1,'posted','supplier_payment',$2,$3,$3,now()) returning id,entry_number`,
   ["سداد فاتورة المورد "+inv.internal_number,inv.id,req.user.sub]);
  await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,$4,0)",[journal.rows[0].id,inv.payable_account_id,"تسوية ذمم المورد "+paymentNumber,amount]);
  await db.query("insert into journal_lines(entry_id,account_id,description,debit,credit) values($1,$2,$3,0,$4)",[journal.rows[0].id,p.data.payment_account_id,"صرف دفعة المورد "+paymentNumber,amount]);
  const payment=await db.query(`insert into supplier_invoice_payments(payment_number,supplier_invoice_id,amount,payment_method,payment_account_id,reference_number,journal_entry_id,created_by)
   values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
   [paymentNumber,inv.id,amount,p.data.payment_method,p.data.payment_account_id,p.data.reference_number||null,journal.rows[0].id,req.user.sub]);
  await db.query("commit");
  await audit(req.user.sub,"procurement.supplier_payment_created","supplier_invoice_payment",payment.rows[0].id,{payment_number:paymentNumber,invoice_id:inv.id,amount});
  res.status(201).json({payment:payment.rows[0],journal:journal.rows[0],outstanding:Math.max(0,outstanding-amount)});
 }catch(e){
  await db.query("rollback");
  const messages={SUPPLIER_INVOICE_UNAVAILABLE:"فاتورة المورد غير موجودة أو لم تُرحّل",PAYABLE_ACCOUNT_MISSING:"فاتورة المورد لا تحتوي حساب الدائنين",PAYMENT_EXCEEDS_DUE:"مبلغ السداد يتجاوز المتبقي على فاتورة المورد",PAYMENT_ACCOUNT_TYPES:"اختر حساب صندوق أو بنك نشطاً وحساب دائنين نشطاً ومختلفين"};
  const known=messages[e.message];if(!known)console.error("supplier payment failed",e.message);
  res.status(known?400:500).json({error:known||"تعذر تسجيل دفعة المورد"});
 }finally{db.release();}
});

// Payroll draft runs: figures are entered and approved by management; statutory calculations are not automated. figures are entered and approved by management; statutory calculations are not automated. figures are entered and approved by management; statutory calculations are not automated.
app.get("/api/payroll/runs",auth,enterpriseManager,async(_req,res)=>{const r=await pool.query("select * from payroll_runs order by period_start desc limit 100");res.json({runs:r.rows});});
app.post("/api/payroll/runs",auth,enterpriseManager,async(req,res)=>{const p=z.object({period_start:z.string().date(),period_end:z.string().date(),items:z.array(z.object({employee_id:z.string().uuid(),basic_salary:z.coerce.number().min(0),allowances:z.coerce.number().min(0).default(0),deductions:z.coerce.number().min(0).default(0),notes:z.string().max(1000).optional()})).min(1).max(500)}).refine(v=>v.period_end>=v.period_start).safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من فترة المسير وبيانات الموظفين"});if(p.data.items.some(x=>x.deductions>x.basic_salary+x.allowances))return res.status(400).json({error:"الاستقطاعات لا يمكن أن تتجاوز إجمالي المستحقات"});const db=await pool.connect();try{await db.query("begin");const ids=[...new Set(p.data.items.map(x=>x.employee_id))];if(ids.length!==p.data.items.length)throw new Error("DUPLICATE_EMPLOYEE");const active=await db.query("select id from employees where id=any($1::uuid[]) and status='active'",[ids]);if(active.rowCount!==ids.length)throw new Error("EMPLOYEE_INVALID");const gross=p.data.items.reduce((s,x)=>s+x.basic_salary+x.allowances,0),ded=p.data.items.reduce((s,x)=>s+x.deductions,0);const run=await db.query("insert into payroll_runs(run_number,period_start,period_end,total_gross,total_deductions,total_net,created_by) values('PAY-'||lpad(nextval('payroll_run_number_seq')::text,6,'0'),$1,$2,$3,$4,$5,$6) returning *",[p.data.period_start,p.data.period_end,gross,ded,gross-ded,req.user.sub]);for(const x of p.data.items){const g=x.basic_salary+x.allowances;await db.query("insert into payroll_items(run_id,employee_id,basic_salary,allowances,deductions,gross_salary,net_salary,notes) values($1,$2,$3,$4,$5,$6,$7,$8)",[run.rows[0].id,x.employee_id,x.basic_salary,x.allowances,x.deductions,g,g-x.deductions,x.notes||null]);}await db.query("commit");await audit(req.user.sub,"payroll.run_created","payroll_run",run.rows[0].id);res.status(201).json({run:run.rows[0]});}catch(e){await db.query("rollback");res.status(400).json({error:e.message==="EMPLOYEE_INVALID"?"يوجد موظف غير نشط أو غير موجود":e.message==="DUPLICATE_EMPLOYEE"?"لا تكرر الموظف في المسير":"تعذر إنشاء مسير الرواتب"});}finally{db.release();}});
app.get("/api/payroll/runs/:id/items",auth,enterpriseManager,async(req,res)=>{const r=await pool.query("select p.*,e.employee_number,e.full_name from payroll_items p join employees e on e.id=p.employee_id where p.run_id=$1 order by e.full_name",[req.params.id]);res.json({items:r.rows});});
app.patch("/api/payroll/runs/:id/approve",auth,admin,async(req,res)=>{const r=await pool.query("update payroll_runs set status='approved',approved_by=$1,approved_at=now() where id=$2 and status='draft' returning *",[req.user.sub,req.params.id]);if(!r.rowCount)return res.status(409).json({error:"المسير غير موجود أو ليس مسودة"});await audit(req.user.sub,"payroll.run_approved","payroll_run",req.params.id);res.json({run:r.rows[0]});});
// Fixed assets and maintenance
app.get("/api/assets",auth,async(_req,res)=>{const r=await pool.query("select a.*,e.full_name as assigned_employee from fixed_assets a left join employees e on e.id=a.assigned_employee_id order by a.created_at desc limit 500");res.json({assets:r.rows});});
app.post("/api/assets",auth,enterpriseManager,async(req,res)=>{const p=z.object({asset_name:z.string().trim().min(2).max(180),category:z.string().trim().min(2).max(100),serial_number:z.string().max(120).optional(),purchase_date:z.string().date().optional(),purchase_cost:z.coerce.number().min(0),useful_life_months:z.coerce.number().int().min(1).max(1200),salvage_value:z.coerce.number().min(0),location:z.string().max(180).optional(),assigned_employee_id:z.string().uuid().optional(),notes:z.string().max(3000).optional()}).refine(v=>v.salvage_value<=v.purchase_cost).safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من بيانات الأصل وقيمته"});try{const r=await pool.query("insert into fixed_assets(asset_number,asset_name,category,serial_number,purchase_date,purchase_cost,useful_life_months,salvage_value,location,assigned_employee_id,notes,created_by) values('AST-'||lpad(nextval('asset_number_seq')::text,6,'0'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *",[p.data.asset_name,p.data.category,p.data.serial_number||null,p.data.purchase_date||null,p.data.purchase_cost,p.data.useful_life_months,p.data.salvage_value,p.data.location||null,p.data.assigned_employee_id||null,p.data.notes||null,req.user.sub]);await audit(req.user.sub,"asset.created","fixed_asset",r.rows[0].id);res.status(201).json({asset:r.rows[0]});}catch(e){res.status(500).json({error:"تعذر تسجيل الأصل"});}});
app.get("/api/assets/:id/maintenance",auth,async(req,res)=>{const r=await pool.query("select * from asset_maintenance where asset_id=$1 order by maintenance_date desc",[req.params.id]);res.json({maintenance:r.rows});});
app.post("/api/assets/:id/maintenance",auth,enterpriseManager,async(req,res)=>{const p=z.object({maintenance_date:z.string().date(),description:z.string().trim().min(2).max(2000),cost:z.coerce.number().min(0),next_due_date:z.string().date().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"بيانات الصيانة غير صالحة"});try{const r=await pool.query("insert into asset_maintenance(asset_id,maintenance_date,description,cost,next_due_date,created_by) values($1,$2,$3,$4,$5,$6) returning *",[req.params.id,p.data.maintenance_date,p.data.description,p.data.cost,p.data.next_due_date||null,req.user.sub]);res.status(201).json({maintenance:r.rows[0]});}catch(e){res.status(404).json({error:"الأصل غير موجود أو تعذر تسجيل الصيانة"});}});
// Helpdesk tickets and private internal notes
app.get("/api/helpdesk/tickets",auth,async(req,res)=>{const manager=["admin","manager"].includes(req.user.role);const r=await pool.query("select * from support_tickets "+(manager?"":"where requester_id=$1 ")+"order by created_at desc limit 300",manager?[]:[req.user.sub]);res.json({tickets:r.rows});});
app.post("/api/helpdesk/tickets",auth,async(req,res)=>{const p=z.object({subject:z.string().trim().min(3).max(240),description:z.string().trim().min(5).max(10000),category:z.string().max(60).default("general"),priority:z.enum(["low","normal","high","urgent"]).default("normal")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"تحقق من عنوان البلاغ ووصفه"});try{const u=await pool.query("select full_name,email from users where id=$1",[req.user.sub]);const r=await pool.query("insert into support_tickets(ticket_number,requester_id,requester_name,requester_email,subject,description,category,priority) values('TKT-'||lpad(nextval('support_ticket_number_seq')::text,6,'0'),$1,$2,$3,$4,$5,$6,$7) returning *",[req.user.sub,u.rows[0].full_name,u.rows[0].email,p.data.subject,p.data.description,p.data.category,p.data.priority]);await audit(req.user.sub,"helpdesk.ticket_created","support_ticket",r.rows[0].id);res.status(201).json({ticket:r.rows[0]});}catch(e){res.status(500).json({error:"تعذر إنشاء البلاغ"});}});
app.patch("/api/helpdesk/tickets/:id/status",auth,enterpriseManager,async(req,res)=>{const p=z.object({status:z.enum(["open","in_progress","waiting","resolved","closed"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"الحالة غير صالحة"});const r=await pool.query("update support_tickets set status=$1,updated_at=now(),resolved_at=case when $1 in ('resolved','closed') then now() else null end where id=$2 returning *",[p.data.status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"البلاغ غير موجود"});await audit(req.user.sub,"helpdesk.ticket_status_changed","support_ticket",req.params.id,{status:p.data.status});res.json({ticket:r.rows[0]});});
app.get("/api/helpdesk/tickets/:id/messages",auth,async(req,res)=>{const ticket=await pool.query("select requester_id from support_tickets where id=$1",[req.params.id]);if(!ticket.rowCount)return res.status(404).json({error:"البلاغ غير موجود"});const manager=["admin","manager"].includes(req.user.role);if(ticket.rows[0].requester_id!==req.user.sub&&!manager)return res.status(403).json({error:"لا تملك صلاحية الاطلاع"});const r=await pool.query("select m.id,m.message,m.is_internal,m.created_at,u.full_name as author from support_ticket_messages m left join users u on u.id=m.author_id where m.ticket_id=$1 and (m.is_internal=false or $2=true) order by m.created_at",[req.params.id,manager]);res.json({messages:r.rows});});
app.post("/api/helpdesk/tickets/:id/messages",auth,async(req,res)=>{const p=z.object({message:z.string().trim().min(1).max(10000),is_internal:z.boolean().default(false)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"الرسالة غير صالحة"});const t=await pool.query("select requester_id from support_tickets where id=$1",[req.params.id]);if(!t.rowCount)return res.status(404).json({error:"البلاغ غير موجود"});const manager=["admin","manager"].includes(req.user.role);if(t.rows[0].requester_id!==req.user.sub&&!manager)return res.status(403).json({error:"لا تملك صلاحية الرد"});if(p.data.is_internal&&!manager)return res.status(403).json({error:"الملاحظات الداخلية للمدير فقط"});const r=await pool.query("insert into support_ticket_messages(ticket_id,author_id,message,is_internal) values($1,$2,$3,$4) returning *",[req.params.id,req.user.sub,p.data.message,p.data.is_internal]);await pool.query("update support_tickets set updated_at=now() where id=$1",[req.params.id]);res.status(201).json({message:r.rows[0]});});
// Read-only BI aggregation from the platform's own PostgreSQL database.
app.get("/api/bi/summary",auth,enterpriseManager,async(_req,res)=>{try{const [f,o,c,p,a]=await Promise.all([pool.query("select * from bi_finance_summary"),pool.query("select * from bi_operations_summary"),pool.query("select status,count(*)::int as count from crm_leads group by status"),pool.query("select status,count(*)::int as count from purchase_requests group by status"),pool.query("select status,count(*)::int as count from payroll_runs group by status")]);res.json({finance:f.rows[0],operations:o.rows[0],crm:c.rows,procurement:p.rows,payroll:a.rows});}catch(e){res.status(503).json({error:"تعذر تحميل مؤشرات الأعمال. تحقق من تطبيق الترحيل 012."});}});

app.use((err, _req, res, _next) => { console.error("request error", err.message); res.status(500).json({ error: "حدث خطأ داخلي" }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => console.log(`Suhool Tech API listening on ${port}`));
