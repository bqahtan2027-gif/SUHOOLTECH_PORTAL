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

app.use((err, _req, res, _next) => { console.error("request error", err.message); res.status(500).json({ error: "حدث خطأ داخلي" }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => console.log(`Suhool Tech API listening on ${port}`));
