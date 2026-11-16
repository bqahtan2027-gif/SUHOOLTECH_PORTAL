import { useEffect, useState } from "react";

type Meeting={id:string;title:string;description?:string;location?:string;starts_at:string;ends_at:string;status:"scheduled"|"completed"|"cancelled";organizer_id:string;organizer_name?:string;attendees?:Array<{user_id:string;full_name:string;response:string}>};
type User={id:string;full_name:string;email:string};
type Props={token:string;role:string;userId:string};
const statusLabel:Record<string,string>={scheduled:"مجدول",completed:"مكتمل",cancelled:"ملغي"};
const localInput=(date:Date)=>{const d=new Date(date.getTime()-date.getTimezoneOffset()*60000);return d.toISOString().slice(0,16);};

export default function Calendar({token,role,userId}:Props){
 const [meetings,setMeetings]=useState<Meeting[]>([]);
 const [users,setUsers]=useState<User[]>([]);
 const [form,setForm]=useState({title:"",description:"",location:"",starts_at:localInput(new Date(Date.now()+3600000)),ends_at:localInput(new Date(Date.now()+7200000))});
 const [attendees,setAttendees]=useState<string[]>([]);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const manager=role==="admin"||role==="manager";
 const load=async()=>{
  const headers={Authorization:"Bearer "+token};
  const r=await fetch("/api/meetings",{headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل الاجتماعات");setMeetings(d.meetings||[]);
  const u=await fetch("/api/meetings/users",{headers});const ud=await u.json();if(!u.ok)throw new Error(ud.error||"تعذر تحميل قائمة الموظفين");setUsers(ud.users||[]);
 };
 useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"تعذر تحميل التقويم"));},[token]);
 const create=async(e:React.FormEvent<HTMLFormElement>)=>{
  e.preventDefault();setBusy(true);setError("");
  try{
   const r=await fetch("/api/meetings",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({...form,attendee_ids:attendees})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر إنشاء الاجتماع");
   setMeetings(v=>[d.meeting,...v].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)));
   setForm(v=>({...v,title:"",description:"",location:""}));setAttendees([]);
  }catch(e){setError(e instanceof Error?e.message:"تعذر إنشاء الاجتماع");}finally{setBusy(false);}
 };
 const changeStatus=async(id:string,status:"completed"|"cancelled")=>{
  setError("");
  try{const r=await fetch("/api/meetings/"+id+"/status",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث الاجتماع");setMeetings(v=>v.map(m=>m.id===id?{...m,...d.meeting}:m));}
  catch(e){setError(e instanceof Error?e.message:"تعذر تحديث الاجتماع");}
 };
 const respond=async(id:string,response:"accepted"|"declined")=>{
  setError("");
  try{const r=await fetch("/api/meetings/"+id+"/response",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({response})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تسجيل الرد");setMeetings(v=>v.map(m=>m.id===id?{...m,attendees:m.attendees?.map(a=>a.user_id===userId?{...a,response}:a)}:m));}
  catch(e){setError(e instanceof Error?e.message:"تعذر تسجيل الرد");}
 };
 const fmt=(v:string)=>new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));
 return <section className="tasks-panel">
  <div className="section-kicker">تنظيم الوقت والاجتماعات</div><h2>التقويم والاجتماعات</h2><p>أنشئ اجتماعات العمل وادعُ أعضاء الفريق وتابع تأكيد الحضور.</p>
  {error&&<div className="auth-error">{error}</div>}
  <h3>جدولة اجتماع</h3>
  <form className="task-create" onSubmit={create} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
   <input required minLength={3} maxLength={200} placeholder="عنوان الاجتماع" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/>
   <input maxLength={240} placeholder="المكان أو رابط الاجتماع" value={form.location} onChange={e=>setForm(v=>({...v,location:e.target.value}))}/>
   <label>يبدأ<input type="datetime-local" required value={form.starts_at} onChange={e=>setForm(v=>({...v,starts_at:e.target.value}))}/></label>
   <label>ينتهي<input type="datetime-local" required value={form.ends_at} onChange={e=>setForm(v=>({...v,ends_at:e.target.value}))}/></label>
   <textarea maxLength={4000} placeholder="جدول الأعمال وملاحظات الاجتماع" value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} style={{gridColumn:"1 / -1",minHeight:80,padding:12,font:"inherit"}}/>
   <div style={{gridColumn:"1 / -1"}}><strong>دعوة المشاركين</strong><div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:8}}>{users.filter(u=>u.id!==userId).map(u=><label key={u.id} style={{display:"flex",alignItems:"center",gap:5}}><input type="checkbox" checked={attendees.includes(u.id)} onChange={e=>setAttendees(v=>e.target.checked?[...v,u.id]:v.filter(x=>x!==u.id))}/>{u.full_name}</label>)}</div></div>
   <button disabled={busy}>{busy?"جارٍ الحفظ...":"جدولة الاجتماع"}</button>
  </form>
  <div className="section-kicker" style={{marginTop:28}}>جدول الاجتماعات</div>
  <div className="task-list">{meetings.map(m=>{
   const own=m.organizer_id===userId;
   const mine=m.attendees?.find(a=>a.user_id===userId);
   return <article className="task-row" key={m.id}><div style={{minWidth:0,flex:1}}>
    <strong>{m.title}</strong><small>{fmt(m.starts_at)} — {fmt(m.ends_at)}</small>
    <small>{m.location||"لم يحدد المكان"} · المنظم: {m.organizer_name||"مستخدم"} · {statusLabel[m.status]}</small>
    {m.description&&<details><summary style={{cursor:"pointer"}}>جدول الأعمال</summary><p style={{whiteSpace:"pre-wrap"}}>{m.description}</p></details>}
    {m.attendees&&<small>المشاركون: {m.attendees.map(a=>a.full_name+" ("+(a.response==="accepted"?"مؤكد":a.response==="declined"?"اعتذر":"بانتظار الرد")+")").join("، ")}</small>}
   </div>
   {mine&&m.status==="scheduled"&&<div style={{display:"flex",gap:5}}><button type="button" onClick={()=>respond(m.id,"accepted")}>تأكيد</button><button type="button" onClick={()=>respond(m.id,"declined")}>اعتذار</button></div>}
   {(own||manager)&&m.status==="scheduled"&&<div style={{display:"flex",gap:5}}><button type="button" onClick={()=>changeStatus(m.id,"completed")}>إكمال</button><button type="button" onClick={()=>changeStatus(m.id,"cancelled")}>إلغاء</button></div>}
   </article>;
  })}{meetings.length===0&&<div className="empty-state">لا توجد اجتماعات مجدولة.</div>}</div>
 </section>;
}
