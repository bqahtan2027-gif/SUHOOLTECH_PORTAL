import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, Bell, Building2, CalendarDays,
  Check, ChevronDown, CircleHelp, Clock3, FileCheck2, FileText, FolderKanban,
  Globe2, KeyRound, LayoutDashboard, Menu, Search, Settings2, ShieldCheck,
  Users, X, Zap
} from "lucide-react";

type Module = {
  id: string;
  title: string;
  description: string;
  icon: typeof FolderKanban;
  color: string;
  bg: string;
  status: "active" | "planned";
  label: string;
};

const modules: Module[] = [
  { id: "projects", title: "المهام والمشاريع", description: "تابع المشاريع والمهام وسير العمل من مكان واحد.", icon: FolderKanban, color: "blue", bg: "blue-bg", status: "active", label: "متاح" },
  { id: "quotes", title: "عروض الأسعار", description: "إعداد عروض الأسعار ومتابعتها وإدارة تفاصيلها.", icon: FileText, color: "teal", bg: "teal-bg", status: "active", label: "متاح" },
  { id: "hr", title: "الموارد البشرية", description: "ملفات الموظفين والإجازات والحضور.", icon: Users, color: "green", bg: "green-bg", status: "planned", label: "قريباً" },
  { id: "documents", title: "المسودات والمستندات", description: "إنشاء المستندات ومراجعتها واعتمادها وأرشفتها.", icon: FileCheck2, color: "purple", bg: "purple-bg", status: "planned", label: "قريباً" },
  { id: "admin", title: "الخدمات الإدارية", description: "الطلبات الداخلية والموافقات والعهد والمشتريات.", icon: Building2, color: "orange", bg: "orange-bg", status: "planned", label: "قريباً" },
  { id: "vault", title: "خزنة كلمات المرور", description: "إدارة أسرار الشركة والخزن الشخصية بصلاحيات دقيقة.", icon: KeyRound, color: "navy", bg: "navy-bg", status: "planned", label: "مرحلة لاحقة" },
];

function Brand() {
  return <div className="brand">
    <div className="brand-mark"><span>S</span></div>
    <div className="brand-copy"><strong>SUHOOL <i>TECH</i></strong><small>سهول تيك</small></div>
  </div>;
}

export default function App() {
  const [activeNav, setActiveNav] = useState("overview");
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{full_name:string;email:string;role:string} | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [tasks, setTasks] = useState<Array<{id:string;title:string;status:string;priority:string;due_date?:string}>>([]);
  const [projects, setProjects] = useState<Array<{id:string;name:string;description?:string;status:string;due_date?:string}>>([]);
  const [projectName, setProjectName] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [summary, setSummary] = useState<{projects:{total:number;active:number;completed:number};tasks:{total:number;completed:number;open:number;overdue:number};users:{total:number;active:number}} | null>(null);
  const [users, setUsers] = useState<Array<{id:string;full_name:string;email:string;role:string;active:boolean;last_login_at?:string}>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<{id:number;action:string;entity_type:string;entity_id?:string;actor_name?:string;created_at:string}>>([]);
  const [quotes, setQuotes] = useState<Array<{id:string;quote_number:string;client_name:string;status:string;subtotal:string;tax_amount:string;total:string;valid_until?:string;items:Array<{description:string}>}>>([]);
  const [quoteForm, setQuoteForm] = useState({client_name:"",client_email:"",description:"",quantity:"1",unit_price:"",discount_amount:"",valid_until:"",notes:""});
  const [quoteError, setQuoteError] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [newUser, setNewUser] = useState({name:"",email:"",password:"",role:"employee"});
  const [userError, setUserError] = useState("");
  const [userBusy, setUserBusy] = useState(false);
  useEffect(() => {
    if (!token || currentUser?.role !== "admin" || !["admin-users","activity"].includes(activeNav)) return;
    const headers = { Authorization: `Bearer ${token}` };
    if (activeNav === "admin-users") fetch("/api/users", {headers}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل المستخدمين");setUsers(d.users||[]);}).catch(e=>setUserError(e instanceof Error?e.message:"تعذر تحميل المستخدمين"));
    if (activeNav === "activity") fetch("/api/audit-logs?limit=100", {headers}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل سجل النشاط");setAuditLogs(d.logs||[]);}).catch(e=>setUserError(e instanceof Error?e.message:"تعذر تحميل سجل النشاط"));
  }, [activeNav, token, currentUser]);
  useEffect(() => {
    if (!token) return;
    fetch("/api/dashboard/summary", { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const data = await response.json(); if (response.ok) setSummary(data); })
      .catch(() => undefined);
  }, [token]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState("");
  useEffect(() => {
    if (activeNav !== "quotes" || !token) return;
    fetch("/api/quotes", {headers:{Authorization:`Bearer ${token}`}}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل عروض الأسعار");setQuotes(d.quotes||[]);}).catch(e=>setQuoteError(e instanceof Error?e.message:"تعذر تحميل عروض الأسعار"));
  }, [activeNav, token]);
  useEffect(() => {
    if (activeNav !== "projects" || !token) return;
    fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر تحميل المشاريع"); setProjects(data.projects || []); })
      .catch(error => setProjectError(error instanceof Error ? error.message : "تعذر تحميل المشاريع"));
  }, [activeNav, token]);
  useEffect(() => {
    if (activeNav !== "projects" || !token) return;
    fetch("/api/tasks", { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر تحميل المهام"); setTasks(data.tasks || []); })
      .catch(error => setTaskError(error instanceof Error ? error.message : "تعذر تحميل المهام"));
  }, [activeNav, token]);
  const createQuote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if(!token)return; setQuoteBusy(true); setQuoteError("");
    try {
      const response=await fetch("/api/quotes",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({
        client_name:quoteForm.client_name,client_email:quoteForm.client_email,valid_until:quoteForm.valid_until||undefined,
        discount_amount:Number(quoteForm.discount_amount||0),notes:quoteForm.notes,
        items:[{description:quoteForm.description,quantity:Number(quoteForm.quantity),unit_price:Number(quoteForm.unit_price)}]
      })});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||"تعذر إنشاء عرض السعر");
      setQuotes(current=>[data.quote,...current]); setQuoteForm({client_name:"",client_email:"",description:"",quantity:"1",unit_price:"",discount_amount:"",valid_until:"",notes:""});
    } catch(error){setQuoteError(error instanceof Error?error.message:"تعذر إنشاء عرض السعر");}
    finally{setQuoteBusy(false);}
  };
  const changeQuoteStatus = async (id:string,status:string) => {
    if(!token)return; setQuoteError("");
    try { const response=await fetch(`/api/quotes/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({status})}); const data=await response.json(); if(!response.ok)throw new Error(data.error||"تعذر تحديث العرض"); setQuotes(current=>current.map(q=>q.id===id?{...q,status:data.quote.status}:q)); }
    catch(error){setQuoteError(error instanceof Error?error.message:"تعذر تحديث حالة العرض");}
  };
  const createEmployee=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!token)return;setHrBusy(true);setHrError("");
    try{const r=await fetch("/api/hr/employees",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({...employeeForm,hire_date:employeeForm.hire_date||undefined})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر إضافة الموظف");setEmployees(v=>[d.employee,...v]);setEmployeeForm({full_name:"",email:"",phone:"",department:"",job_title:"",hire_date:""});}
    catch(e){setHrError(e instanceof Error?e.message:"تعذر إضافة الموظف");}finally{setHrBusy(false);}
  };
  const createLeave=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!token)return;setHrBusy(true);setHrError("");
    try{const r=await fetch("/api/hr/leaves",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(leaveForm)});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر إرسال الطلب");setLeaves(v=>[d.leave,...v]);setLeaveForm({leave_type:"annual",start_date:"",end_date:"",reason:""});}
    catch(e){setHrError(e instanceof Error?e.message:"تعذر إرسال الطلب");}finally{setHrBusy(false);}
  };
  const decideLeave=async(id:string,status:"approved"|"rejected")=>{
    if(!token)return;setHrError("");
    try{const r=await fetch("/api/hr/leaves/"+id+"/status",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث الطلب");setLeaves(v=>v.map(x=>x.id===id?{...x,status:d.leave.status}:x));}
    catch(e){setHrError(e instanceof Error?e.message:"تعذر تحديث الطلب");}
  };
  const changeEmployeeStatus=async(id:string,status:string)=>{
    if(!token)return;setHrError("");
    try{const r=await fetch("/api/hr/employees/"+id+"/status",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث حالة الموظف");setEmployees(v=>v.map(x=>x.id===id?{...x,status:d.employee.status}:x));}
    catch(e){setHrError(e instanceof Error?e.message:"تعذر تحديث حالة الموظف");}
  };
  const createTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!token || !taskTitle.trim()) return; setTaskBusy(true); setTaskError("");
    try { const response = await fetch("/api/tasks", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`}, body:JSON.stringify({title:taskTitle.trim()}) }); const data=await response.json(); if(!response.ok) throw new Error(data.error || "تعذر إنشاء المهمة"); setTasks(current=>[data.task,...current]); setTaskTitle(""); }
    catch(error){setTaskError(error instanceof Error ? error.message : "تعذر إنشاء المهمة");} finally {setTaskBusy(false);}
  };
  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!token || !projectName.trim()) return;
    setProjectBusy(true); setProjectError("");
    try {
      const response = await fetch("/api/projects", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`}, body:JSON.stringify({name:projectName.trim()}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر إنشاء المشروع");
      setProjects(current=>[data.project,...current]); setProjectName("");
      const refresh = await fetch("/api/dashboard/summary", {headers:{Authorization:`Bearer ${token}`}});
      if (refresh.ok) setSummary(await refresh.json());
    } catch(error) { setProjectError(error instanceof Error ? error.message : "تعذر إنشاء المشروع"); }
    finally { setProjectBusy(false); }
  };
  const changeProjectStatus = async (id:string,status:string) => {
    if(!token)return;
    try {
      const response=await fetch(`/api/projects/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({status})});
      const data=await response.json(); if(!response.ok) throw new Error(data.error || "تعذر تحديث المشروع");
      setProjects(current=>current.map(project=>project.id===id?data.project:project));
    } catch(error) { setProjectError(error instanceof Error?error.message:"تعذر تحديث المشروع"); }
  };
  const changeTaskStatus = async (id:string,status:string) => { if(!token)return; try { const response=await fetch(`/api/tasks/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({status})}); const data=await response.json(); if(!response.ok) throw new Error(data.error || "تعذر تحديث المهمة"); setTasks(current=>current.map(task=>task.id===id?data.task:task)); } catch(error){setTaskError(error instanceof Error?error.message:"تعذر تحديث المهمة");} };
  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if(!token)return; setUserBusy(true); setUserError("");
    try {
      const response=await fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(newUser)});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||"تعذر إنشاء المستخدم");
      setUsers(current=>[data.user,...current]); setNewUser({name:"",email:"",password:"",role:"employee"});
    } catch(error){setUserError(error instanceof Error?error.message:"تعذر إنشاء المستخدم");}
    finally{setUserBusy(false);}
  };
  const updateUser = async (id:string, patch:{role?:string;active?:boolean}) => {
    if(!token)return; setUserError("");
    try {
      const response=await fetch(`/api/users/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(patch)});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||"تعذر تحديث المستخدم");
      setUsers(current=>current.map(user=>user.id===id?data.user:user));
    } catch(error){setUserError(error instanceof Error?error.message:"تعذر تحديث المستخدم");}
  };
  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoginBusy(true); setLoginError("");
    try {
      const response = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:loginEmail,password:loginPassword}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تسجيل الدخول");
      setToken(data.token); setCurrentUser(data.user); setLoginPassword("");
    } catch (error) { setLoginError(error instanceof Error ? error.message : "تعذر الاتصال بالخادم"); }
    finally { setLoginBusy(false); }
  };
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const filtered = useMemo(() => modules.filter((m) => m.title.includes(query.trim())), [query]);
  const isArabic = language === "ar";

  if (!token) return <div className="auth-screen" dir="rtl"><div className="auth-card"><Brand/><div className="auth-eyebrow">بوابة سهول تيك الآمنة</div><h1>مرحباً بعودتك</h1><p>سجّل الدخول للوصول إلى مساحة عمل الشركة.</p><form onSubmit={signIn}><label>البريد الإلكتروني<input type="email" autoComplete="username" required value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="name@company.com"/></label><label>كلمة المرور<input type="password" autoComplete="current-password" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="أدخل كلمة المرور"/></label>{loginError && <div className="auth-error">{loginError}</div>}<button className="auth-submit" disabled={loginBusy}>{loginBusy ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}</button></form><small>تُدار بيانات الدخول على خادم الشركة الخاص.</small></div></div>;

  return <div className={`app-shell ${isArabic ? "rtl" : "ltr"}`} dir={isArabic ? "rtl" : "ltr"}>
    {mobileOpen && <button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="إغلاق"><X size={19}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Building2 size={18}/></div><div><b>{isArabic ? "المقر الرئيسي" : "Head Office"}</b><small>{isArabic ? "مساحة عمل الشركة" : "Company workspace"}</small></div><ChevronDown size={15}/></div>
      <div className="nav-label">{isArabic ? "القائمة الرئيسية" : "MAIN MENU"}</div>
      <nav className="nav-list">
        <button className={activeNav === "overview" ? "nav-item selected" : "nav-item"} onClick={() => setActiveNav("overview")}><LayoutDashboard size={19}/><span>{isArabic ? "نظرة عامة" : "Overview"}</span></button>
        <button className="nav-item" onClick={() => setActiveNav("activity")}><Activity size={19}/><span>{isArabic ? "النشاطات" : "Activity"}</span></button>
        {currentUser?.role === "admin" && <button className={activeNav === "admin-users" ? "nav-item selected" : "nav-item"} onClick={() => setActiveNav("admin-users")}><Users size={19}/><span>إدارة المستخدمين</span></button>}
        <button className="nav-item" onClick={() => setActiveNav("calendar")}><CalendarDays size={19}/><span>{isArabic ? "التقويم" : "Calendar"}</span></button>
      </nav>
      <div className="nav-label systems-label">{isArabic ? "أنظمة الشركة" : "WORKSPACE"}</div>
      <nav className="nav-list">
        {modules.filter(m => m.status === "active").map(m => <button className={activeNav === m.id ? "nav-item selected" : "nav-item"} key={m.id} onClick={() => setActiveNav(m.id)}><m.icon size={19}/><span>{m.title}</span><span className="nav-dot"/></button>)}
      </nav>
      <div className="sidebar-spacer"/>
      <div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>{isArabic ? "هل تحتاج إلى مساعدة؟" : "Need some help?"}</b><p>{isArabic ? "فريقنا هنا لمساعدتك في استخدام المنصة." : "Our team is here to help."}</p><button onClick={() => setActiveNav("help")}>{isArabic ? "مركز المساعدة" : "Help center"} <ArrowLeft size={14}/></button></div>
      <button className="nav-item settings-link" onClick={() => setActiveNav("settings")}><Settings2 size={19}/><span>{isArabic ? "الإعدادات" : "Settings"}</span></button>
      <div className="sidebar-footer"><span className="online-dot"/> {isArabic ? "جميع الأنظمة تعمل بشكل طبيعي" : "All systems operational"}</div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-start"><button className="icon-button menu-toggle" onClick={() => setMobileOpen(true)} aria-label="فتح القائمة"><Menu size={21}/></button><div className="breadcrumb"><span>{isArabic ? "الرئيسية" : "Home"}</span><b>/</b><strong>{isArabic ? "نظرة عامة" : "Overview"}</strong></div></div>
        <div className="topbar-actions">
          <label className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={isArabic ? "ابحث عن نظام..." : "Search systems..."}/><kbd>⌘ K</kbd></label>
          <button className="language-button" onClick={() => setLanguage(isArabic ? "en" : "ar")}><Globe2 size={17}/>{isArabic ? "EN" : "عربي"}</button>
          <button className="icon-button notification-button" aria-label="الإشعارات"><Bell size={19}/><i/></button>
          <button className="user-chip" onClick={() => {setToken(null);setCurrentUser(null);setActiveNav("overview");}} title="تسجيل الخروج"><span className="user-avatar">{currentUser?.full_name?.slice(0,1) || "م"}</span><span className="user-name">{currentUser?.full_name || "المستخدم"}<small>تسجيل الخروج</small></span></button>
        </div>
      </header>

      <div className="page-content">
        {activeNav === "admin-users" && currentUser?.role === "admin" && <section className="tasks-panel">
          <div className="section-kicker">إدارة الوصول</div><h2>المستخدمون والصلاحيات</h2><p>أضف أعضاء الفريق وحدد أدوارهم وحالة حساباتهم.</p>
          <form className="task-create" onSubmit={createUser}>
            <input placeholder="الاسم الكامل" required minLength={2} maxLength={120} value={newUser.name} onChange={e=>setNewUser(v=>({...v,name:e.target.value}))}/>
            <input type="email" placeholder="البريد الإلكتروني" required value={newUser.email} onChange={e=>setNewUser(v=>({...v,email:e.target.value}))}/>
            <input type="password" placeholder="كلمة مرور مؤقتة (12 خانة على الأقل)" required minLength={12} value={newUser.password} onChange={e=>setNewUser(v=>({...v,password:e.target.value}))}/>
            <select value={newUser.role} onChange={e=>setNewUser(v=>({...v,role:e.target.value}))}><option value="employee">موظف</option><option value="manager">مدير فريق</option><option value="admin">مدير النظام</option></select>
            <button disabled={userBusy}>{userBusy?"جارٍ الحفظ...":"إضافة مستخدم"}</button>
          </form>
          {userError && <div className="auth-error">{userError}</div>}
          <div className="task-list">{users.map(user=><article className="task-row" key={user.id}><div><strong>{user.full_name}</strong><small>{user.email} · {user.role==="admin"?"مدير النظام":user.role==="manager"?"مدير فريق":"موظف"} · {user.active?"نشط":"موقوف"}</small></div><div style={{display:"flex",gap:8,alignItems:"center"}}><select aria-label="دور المستخدم" value={user.role} onChange={e=>updateUser(user.id,{role:e.target.value})}><option value="employee">موظف</option><option value="manager">مدير فريق</option><option value="admin">مدير النظام</option></select><button type="button" onClick={()=>updateUser(user.id,{active:!user.active})}>{user.active?"إيقاف":"تفعيل"}</button></div></article>)}</div>
        </section>}
        {activeNav === "activity" && currentUser?.role === "admin" && <section className="tasks-panel"><div className="section-kicker">الشفافية والحوكمة</div><h2>سجل نشاط النظام</h2><p>آخر العمليات المسجلة على حسابات ومشاريع ومهام الشركة.</p>{userError && <div className="auth-error">{userError}</div>}<div className="task-list">{auditLogs.map(log=><article className="task-row" key={log.id}><div><strong>{log.action}</strong><small>{log.actor_name||"النظام"} · {log.entity_type} {log.entity_id||""}</small></div><small>{new Intl.DateTimeFormat("ar-SA",{dateStyle:"short",timeStyle:"short"}).format(new Date(log.created_at))}</small></article>)}{auditLogs.length===0&&<div className="empty-state">لا توجد أحداث مسجلة حتى الآن.</div>}</div></section>}
        {activeNav === "quotes" && <section className="tasks-panel"><div className="section-kicker">المبيعات والتسعير</div><h2>عروض الأسعار</h2><p>أنشئ عرضاً للعميل، ويحسب النظام ضريبة القيمة المضافة 15٪ والإجمالي تلقائياً.</p>
          {(currentUser?.role==="admin"||currentUser?.role==="manager") && <form className="task-create" onSubmit={createQuote} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
            <input placeholder="اسم العميل" required minLength={2} value={quoteForm.client_name} onChange={e=>setQuoteForm(v=>({...v,client_name:e.target.value}))}/>
            <input type="email" placeholder="البريد الإلكتروني (اختياري)" value={quoteForm.client_email} onChange={e=>setQuoteForm(v=>({...v,client_email:e.target.value}))}/>
            <input placeholder="وصف المنتج أو الخدمة" required minLength={2} value={quoteForm.description} onChange={e=>setQuoteForm(v=>({...v,description:e.target.value}))}/>
            <input type="number" min="0.001" step="0.001" placeholder="الكمية" required value={quoteForm.quantity} onChange={e=>setQuoteForm(v=>({...v,quantity:e.target.value}))}/>
            <input type="number" min="0" step="0.01" placeholder="سعر الوحدة (ر.س)" required value={quoteForm.unit_price} onChange={e=>setQuoteForm(v=>({...v,unit_price:e.target.value}))}/>
            <input type="number" min="0" step="0.01" placeholder="الخصم (ر.س)" value={quoteForm.discount_amount} onChange={e=>setQuoteForm(v=>({...v,discount_amount:e.target.value}))}/>
            <input type="date" aria-label="صالح حتى" value={quoteForm.valid_until} onChange={e=>setQuoteForm(v=>({...v,valid_until:e.target.value}))}/>
            <input placeholder="ملاحظات (اختياري)" value={quoteForm.notes} onChange={e=>setQuoteForm(v=>({...v,notes:e.target.value}))}/>
            <button disabled={quoteBusy||!quoteForm.unit_price}>{quoteBusy?"جارٍ الحفظ...":"إنشاء عرض السعر"}</button>
          </form>}
          {quoteError&&<div className="auth-error">{quoteError}</div>}
          <div className="task-list">{quotes.map(q=><article className="task-row" key={q.id}><div><strong>{q.quote_number} · {q.client_name}</strong><small>{q.items?.map(i=>i.description).join("، ")} · قبل الضريبة: {Number(q.subtotal).toLocaleString("ar-SA")} ر.س · الضريبة: {Number(q.tax_amount).toLocaleString("ar-SA")} ر.س · الإجمالي: <b>{Number(q.total).toLocaleString("ar-SA")} ر.س</b></small><small>{q.valid_until?("صالح حتى "+q.valid_until):"بدون تاريخ انتهاء"} · {q.status==="approved"?"معتمد":q.status==="sent"?"مرسل":q.status==="rejected"?"مرفوض":q.status==="expired"?"منتهي":"مسودة"}</small></div>
            {(currentUser?.role==="admin"||currentUser?.role==="manager")&&<select aria-label="حالة عرض السعر" value={q.status} onChange={e=>changeQuoteStatus(q.id,e.target.value)}><option value="draft">مسودة</option><option value="sent">مرسل</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option><option value="expired">منتهي</option></select>}
          </article>)}{quotes.length===0&&<div className="empty-state">لا توجد عروض أسعار بعد.</div>}</div></section>}
        {activeNav === "hr" && <section className="tasks-panel"><div className="section-kicker">إدارة الأفراد</div><h2>الموارد البشرية</h2><p>دليل الموظفين وطلبات الإجازة مع اعتماد المدير.</p>
          {hrError&&<div className="auth-error">{hrError}</div>}
          {(currentUser?.role==="admin"||currentUser?.role==="manager")&&<>
            <h3>إضافة موظف</h3><form className="task-create" onSubmit={createEmployee} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
              <input placeholder="اسم الموظف" required minLength={2} value={employeeForm.full_name} onChange={e=>setEmployeeForm(v=>({...v,full_name:e.target.value}))}/>
              <input type="email" placeholder="البريد الإلكتروني" value={employeeForm.email} onChange={e=>setEmployeeForm(v=>({...v,email:e.target.value}))}/>
              <input placeholder="رقم الجوال" value={employeeForm.phone} onChange={e=>setEmployeeForm(v=>({...v,phone:e.target.value}))}/>
              <input placeholder="القسم" value={employeeForm.department} onChange={e=>setEmployeeForm(v=>({...v,department:e.target.value}))}/>
              <input placeholder="المسمى الوظيفي" value={employeeForm.job_title} onChange={e=>setEmployeeForm(v=>({...v,job_title:e.target.value}))}/>
              <input type="date" aria-label="تاريخ التعيين" value={employeeForm.hire_date} onChange={e=>setEmployeeForm(v=>({...v,hire_date:e.target.value}))}/>
              <button disabled={hrBusy}>إضافة إلى سجل الموظفين</button>
            </form>
            <div className="task-list">{employees.map(e=><article className="task-row" key={e.id}><div><strong>{e.employee_number} · {e.full_name}</strong><small>{[e.job_title,e.department,e.email].filter(Boolean).join(" · ")}</small></div><select aria-label="حالة الموظف" value={e.status} onChange={event=>changeEmployeeStatus(e.id,event.target.value)}><option value="active">على رأس العمل</option><option value="on_leave">إجازة</option><option value="suspended">موقوف</option><option value="terminated">منتهي الخدمة</option></select></article>)}{employees.length===0&&<div className="empty-state">لا يوجد موظفون مسجلون.</div>}</div>
          </>}
          <div className="section-kicker" style={{marginTop:28}}>طلبات الإجازة</div><form className="task-create" onSubmit={createLeave} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
            <select value={leaveForm.leave_type} onChange={e=>setLeaveForm(v=>({...v,leave_type:e.target.value}))}><option value="annual">سنوية</option><option value="sick">مرضية</option><option value="emergency">اضطرارية</option><option value="unpaid">بدون راتب</option><option value="other">أخرى</option></select>
            <input type="date" required aria-label="من تاريخ" value={leaveForm.start_date} onChange={e=>setLeaveForm(v=>({...v,start_date:e.target.value}))}/>
            <input type="date" required aria-label="إلى تاريخ" value={leaveForm.end_date} onChange={e=>setLeaveForm(v=>({...v,end_date:e.target.value}))}/>
            <input placeholder="السبب (اختياري)" value={leaveForm.reason} onChange={e=>setLeaveForm(v=>({...v,reason:e.target.value}))}/>
            <button disabled={hrBusy||!leaveForm.start_date||!leaveForm.end_date}>إرسال طلب الإجازة</button>
          </form>
          <div className="task-list">{leaves.map(l=><article className="task-row" key={l.id}><div><strong>{l.requester_name||"طلب إجازة"} · {l.leave_type==="annual"?"سنوية":l.leave_type==="sick"?"مرضية":l.leave_type==="emergency"?"اضطرارية":l.leave_type==="unpaid"?"بدون راتب":"أخرى"}</strong><small>{l.start_date} — {l.end_date}{l.reason?" · "+l.reason:""}</small><small>{l.status==="approved"?"معتمد":l.status==="rejected"?"مرفوض":"بانتظار الاعتماد"}</small></div>
            {(currentUser?.role==="admin"||currentUser?.role==="manager")&&l.status==="pending"&&<div style={{display:"flex",gap:6}}><button type="button" onClick={()=>decideLeave(l.id,"approved")}>اعتماد</button><button type="button" onClick={()=>decideLeave(l.id,"rejected")}>رفض</button></div>}
          </article>)}{leaves.length===0&&<div className="empty-state">لا توجد طلبات إجازة.</div>}</div>
        </section>}
        {activeNav === "projects" && <section className="tasks-panel"><div className="section-kicker">إدارة العمل</div><h2>المشاريع</h2><p>أنشئ مشاريع الفريق وتابع حالتها ومواعيدها.</p><form className="task-create" onSubmit={createProject}><input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="اكتب اسم المشروع الجديد..." required maxLength={180}/><button disabled={projectBusy}>{projectBusy ? "جارٍ الحفظ..." : "إضافة مشروع"}</button></form>{projectError && <div className="auth-error">{projectError}</div>}<div className="task-list">{projects.map(project=><article className="task-row" key={project.id}><div><strong>{project.name}</strong><small>{project.status === "completed" ? "مكتمل" : project.status === "on_hold" ? "متوقف مؤقتاً" : project.status === "cancelled" ? "ملغي" : "نشط"}</small></div><select aria-label="حالة المشروع" value={project.status} onChange={e=>changeProjectStatus(project.id,e.target.value)}><option value="active">نشط</option><option value="on_hold">متوقف مؤقتاً</option><option value="completed">مكتمل</option><option value="cancelled">ملغي</option></select></article>)}{projects.length===0 && <div className="empty-state">لا توجد مشاريع بعد. أضف أول مشروع.</div>}</div><div className="section-kicker" style={{marginTop:32}}>المهام</div><p>أنشئ مهام الفريق وتابع سير تنفيذها.</p><form className="task-create" onSubmit={createTask}><input value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} placeholder="اكتب عنوان المهمة الجديدة..." required maxLength={180}/><button disabled={taskBusy}>{taskBusy ? "جارٍ الحفظ..." : "إضافة مهمة"}</button></form>{taskError && <div className="auth-error">{taskError}</div>}<div className="task-list">{tasks.map(task=><article className="task-row" key={task.id}><div><strong>{task.title}</strong><small>{task.priority === "urgent" ? "عاجلة" : task.priority === "high" ? "مرتفعة" : "عادية"}</small></div><select aria-label="حالة المهمة" value={task.status} onChange={e=>changeTaskStatus(task.id,e.target.value)}><option value="todo">قيد الانتظار</option><option value="in_progress">قيد التنفيذ</option><option value="review">مراجعة</option><option value="done">مكتملة</option><option value="blocked">متوقفة</option></select></article>)}{tasks.length===0 && <div className="empty-state">لا توجد مهام بعد. أضف أول مهمة للفريق.</div>}</div></section>}

        <section className="welcome-row">
          <div><div className="eyebrow"><span className="eyebrow-line"/> {isArabic ? "بوابة الأنظمة المتكاملة" : "INTEGRATED WORKSPACE"}</div><h1>{isArabic ? "مرحباً بك في سهول تيك" : "Welcome to Suhool Tech"}<span className="wave">✦</span></h1><p>{isArabic ? "مساحة عملك الرقمية، كل أدواتك وأنظمتك في مكان واحد." : "Your digital workspace, with all your tools in one place."}</p></div>
          <div className="date-chip"><CalendarDays size={16}/><span>{new Intl.DateTimeFormat(isArabic ? "ar-SA" : "en-US", { dateStyle: "full" }).format(new Date())}</span></div>
        </section>

        <section className="hero-banner">
          <div className="hero-orb orb-one"/><div className="hero-orb orb-two"/>
          <div className="hero-content"><div className="hero-tag"><Zap size={13}/>{isArabic ? "منصة واحدة. إمكانيات متعددة." : "ONE PLATFORM. MANY POSSIBILITIES."}</div><h2>{isArabic ? <>إنجاز أعمالك،<br/><em>بكل سهولة.</em></> : <>Work smarter,<br/><em>achieve more.</em></>}</h2><p>{isArabic ? "انطلق إلى أنظمة شركتك وأدر أعمالك اليومية من بوابة موحدة مصممة لتسهيل إنجازك." : "Access your company systems and manage daily work from one unified portal."}</p><button className="hero-button" onClick={() => document.getElementById("systems")?.scrollIntoView({ behavior: "smooth" })}>{isArabic ? "استكشف الأنظمة" : "Explore systems"} <ArrowLeft size={16}/></button></div>
          <div className="hero-art" aria-hidden="true"><div className="art-ring ring-a"/><div className="art-ring ring-b"/><div className="art-core"><span>S</span></div><div className="float-card card-a"><FolderKanban size={18}/><span>{isArabic ? "إدارة المشاريع" : "Projects"}</span><Check size={15}/></div><div className="float-card card-b"><ShieldCheck size={18}/><span>{isArabic ? "بيئة عمل موحدة" : "Unified workspace"}</span></div></div>
        </section>

        <section className="stats-grid">
          <div className="stat-card"><div className="stat-icon blue-bg"><LayoutDashboard size={19}/></div><div><span>{isArabic ? "المشاريع المسجلة" : "Projects"}</span><strong>{summary?.projects.total ?? 0} <small>مشروع</small></strong></div><div className="stat-decoration blue-decoration"/></div>
          <div className="stat-card"><div className="stat-icon teal-bg"><Zap size={19}/></div><div><span>{isArabic ? "المهام المفتوحة" : "Open tasks"}</span><strong>{summary?.tasks.open ?? 0} <small>مهمة مفتوحة</small></strong></div><div className="stat-decoration teal-decoration"/></div>
          <div className="stat-card"><div className="stat-icon green-bg"><ShieldCheck size={19}/></div><div><span>{isArabic ? "المستخدمون النشطون" : "Active users"}</span><strong className="healthy">{summary ? summary.users.active + " مستخدم نشط" : "متصلة"}</strong></div><div className="stat-decoration green-decoration"/></div>
        </section>

        <section className="systems-section" id="systems">
          <div className="section-heading"><div><div className="section-kicker">{isArabic ? "مساحة العمل" : "YOUR WORKSPACE"}</div><h2>{isArabic ? "أنظمة الشركة" : "Company systems"}</h2><p>{isArabic ? "اختر النظام الذي تريد العمل عليه." : "Choose a system to get started."}</p></div><button className="view-all" onClick={() => setQuery("")}>{isArabic ? "عرض الكل" : "View all"} <ArrowLeft size={15}/></button></div>
          <div className="modules-grid">{filtered.map((m) => <article className={`module-card ${m.status === "planned" ? "module-planned" : ""}`} key={m.id}><div className="module-card-top"><div className={`module-icon ${m.bg} `}><m.icon size={22}/></div><span className={`status-pill ${m.status}`}><i/>{m.label}</span></div><h3>{m.title}</h3><p>{m.description}</p><div className="module-card-bottom"><span>{m.status === "active" ? (isArabic ? "الدخول إلى النظام" : "Open system") : (isArabic ? "ضمن خارطة التطوير" : "On roadmap")}</span>{m.status === "active" ? <button aria-label={`فتح ${m.title}`} onClick={() => setActiveNav(m.id)}><ArrowLeft size={17}/></button> : <span className="lock-label"><Clock3 size={14}/>{isArabic ? "لاحقاً" : "Later"}</span>}</div></article>)}</div>
          {filtered.length === 0 && <div className="empty-state">{isArabic ? "لا توجد أنظمة تطابق بحثك." : "No systems match your search."}</div>}
        </section>

        <footer className="page-footer"><div><Brand/><span className="footer-copy">© {new Date().getFullYear()} Suhool Tech. {isArabic ? "جميع الحقوق محفوظة." : "All rights reserved."}</span></div><span>{isArabic ? "صُنع لتمكين أعمالك" : "Built to empower your work"} <span className="footer-heart">◆</span></span></footer>
      </div>
    </main>
  </div>;
}