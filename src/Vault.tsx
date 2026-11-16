import { useEffect, useState } from "react";
type Item={id:string;title:string;username?:string;notes?:string;scope:"private"|"shared";owner_id:string;owner_name:string;created_at:string;updated_at:string};
type Props={token:string;userId:string;role:string};
export default function Vault({token,userId,role}:Props){
 const [items,setItems]=useState<Item[]>([]);
 const [form,setForm]=useState({title:"",username:"",secret:"",notes:"",scope:"private" as "private"|"shared"});
 const [revealed,setRevealed]=useState<Record<string,string>>({});
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const canShare=role==="admin"||role==="manager";
 const headers={Authorization:"Bearer "+token};
 const load=async()=>{const r=await fetch("/api/vault",{headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل الخزنة");setItems(d.items||[]);};
 useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"تعذر تحميل الخزنة"));},[token]);
 const create=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError("");try{
  const r=await fetch("/api/vault",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(form)});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر حفظ السر");
  setItems(v=>[d.item,...v]);setForm({title:"",username:"",secret:"",notes:"",scope:"private"});
 }catch(e){setError(e instanceof Error?e.message:"تعذر حفظ السر");}finally{setBusy(false);}};
 const reveal=async(id:string)=>{setError("");try{const r=await fetch("/api/vault/"+id+"/reveal",{headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر فك تشفير السر");setRevealed(v=>({...v,[id]:d.secret}));}catch(e){setError(e instanceof Error?e.message:"تعذر عرض السر");}};
 const remove=async(id:string)=>{if(!window.confirm("هل تريد حذف هذا السجل نهائياً؟"))return;setError("");try{const r=await fetch("/api/vault/"+id,{method:"DELETE",headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر الحذف");setItems(v=>v.filter(x=>x.id!==id));setRevealed(v=>{const n={...v};delete n[id];return n;});}catch(e){setError(e instanceof Error?e.message:"تعذر الحذف");}};
 return <section className="tasks-panel"><div className="section-kicker">الأمان وإدارة الوصول</div><h2>خزنة كلمات المرور والأسرار</h2><p>تُشفّر الأسرار داخل الخادم قبل تخزينها. لا تُرسل مفاتيح التشفير إلى المتصفح.</p>
 {error&&<div className="auth-error">{error}</div>}
 <form className="task-create" onSubmit={create} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
  <input required minLength={2} maxLength={160} placeholder="اسم الخدمة أو الحساب" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/>
  <input maxLength={254} placeholder="اسم المستخدم أو البريد" value={form.username} onChange={e=>setForm(v=>({...v,username:e.target.value}))}/>
  <input required minLength={1} maxLength={4096} type="password" autoComplete="new-password" placeholder="كلمة المرور أو المفتاح السري" value={form.secret} onChange={e=>setForm(v=>({...v,secret:e.target.value}))}/>
  <select value={form.scope} onChange={e=>setForm(v=>({...v,scope:e.target.value as "private"|"shared"}))}><option value="private">خزنة شخصية</option>{canShare&&<option value="shared">خزنة مشتركة للفريق</option>}</select>
  <input maxLength={2000} placeholder="ملاحظات غير سرية (اختياري)" value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/>
  <button disabled={busy}>{busy?"جارٍ التشفير والحفظ...":"حفظ مشفر"}</button>
 </form>
 <div className="section-kicker" style={{marginTop:28}}>السجلات المحفوظة</div>
 <div className="task-list">{items.map(item=><article className="task-row" key={item.id}><div style={{minWidth:0,flex:1}}><strong>{item.title}</strong><small>{item.scope==="shared"?"خزنة مشتركة":"خزنة شخصية"} · {item.username||"بدون اسم مستخدم"} · المالك: {item.owner_name}</small>{item.notes&&<small>{item.notes}</small>}{revealed[item.id]!==undefined&&<div style={{marginTop:8,overflowWrap:"anywhere",fontFamily:"monospace"}}>{revealed[item.id]}</div>}</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button type="button" onClick={()=>revealed[item.id]===undefined?reveal(item.id):setRevealed(v=>{const n={...v};delete n[item.id];return n;})}>{revealed[item.id]===undefined?"إظهار السر":"إخفاء"}</button>{(item.owner_id===userId||canShare&&item.scope==="shared")&&<button type="button" onClick={()=>remove(item.id)}>حذف</button>}</div></article>)}{items.length===0&&<div className="empty-state">لا توجد أسرار محفوظة حتى الآن.</div>}</div>
 <p style={{marginTop:18,fontSize:12,opacity:.75}}>تنبيه: احتفظ بنسخة احتياطية آمنة من مفتاح VAULT_ENCRYPTION_KEY. فقدانه يعني عدم إمكانية استعادة الأسرار المشفرة. لا تستخدم الخزنة للإنتاج قبل إعداد المفتاح واختبار النسخ الاحتياطي.</p>
 </section>;
}
