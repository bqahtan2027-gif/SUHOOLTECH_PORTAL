import {useEffect,useState} from "react";
import {ExternalLink,Save,RefreshCw} from "lucide-react";

type Settings={integration_mode:"manual"|"api";portal_url:string|null;api_base_url:string|null;api_enabled:boolean};
export default function ZatcaSettings({token,role}:{token:string|null;role:string}){
 const [settings,setSettings]=useState<Settings>({integration_mode:"manual",portal_url:"",api_base_url:"",api_enabled:false});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
 const load=async()=>{if(!token||role!=="admin")return;setBusy(true);setError("");try{const r=await fetch("/api/zatca/connection",{headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل الإعدادات");setSettings({integration_mode:d.settings.integration_mode||"manual",portal_url:d.settings.portal_url||"",api_base_url:d.settings.api_base_url||"",api_enabled:!!d.settings.api_enabled});}catch(e){setError(e instanceof Error?e.message:"تعذر تحميل الإعدادات");}finally{setBusy(false);}};
 useEffect(()=>{void load();},[token,role]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError("");setNotice("");try{const r=await fetch("/api/zatca/connection",{method:"PUT",headers,body:JSON.stringify(settings)});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر الحفظ");setSettings({...d.settings,portal_url:d.settings.portal_url||"",api_base_url:d.settings.api_base_url||""});setNotice("تم حفظ إعدادات الربط.");}catch(e){setError(e instanceof Error?e.message:"تعذر الحفظ");}finally{setBusy(false);}};
 if(role!=="admin")return <section className="tasks-panel"><h2>إعدادات ربط ZATCA</h2><p>هذه الإعدادات متاحة لمدير النظام فقط.</p></section>;
 return <section className="tasks-panel"><div className="section-kicker">الفوترة الإلكترونية</div><h2>إعدادات الربط مع ZATCA</h2><p>يمكن حفظ رابط بوابة الهيئة وعنوان API الآن، ثم استكمال التكامل البرمجي لاحقاً. حفظ العناوين لا يعني أن الإرسال أو الاعتماد الإلكتروني يعمل حالياً.</p>{error&&<div className="auth-error">{error}</div>}{notice&&<div className="success-message">{notice}</div>}
 <form className="task-create" onSubmit={save} style={{display:"grid",gap:12}}>
  <label>طريقة الربط<select value={settings.integration_mode} onChange={e=>setSettings(v=>({...v,integration_mode:e.target.value as "manual"|"api",api_enabled:e.target.value==="api"?v.api_enabled:false}))}><option value="manual">رابط البوابة فقط (حالياً)</option><option value="api">تكامل API (للتجهيز لاحقاً)</option></select></label>
  <label>رابط بوابة ZATCA<input type="url" placeholder="https://..." value={settings.portal_url||""} onChange={e=>setSettings(v=>({...v,portal_url:e.target.value}))}/></label>
  <label>عنوان API الأساسي<input type="url" placeholder="https://api.example.sa/..." value={settings.api_base_url||""} onChange={e=>setSettings(v=>({...v,api_base_url:e.target.value}))}/></label>
  <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={settings.api_enabled} disabled={settings.integration_mode!=="api"} onChange={e=>setSettings(v=>({...v,api_enabled:e.target.checked}))}/> تفعيل عنوان API عند اكتمال إعداد التكامل</label>
  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><button disabled={busy}><Save size={16}/> حفظ الإعدادات</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button>{settings.portal_url&&<a href={settings.portal_url} target="_blank" rel="noreferrer"><ExternalLink size={15}/> فتح بوابة الهيئة</a>}</div>
 </form><div className="empty-state" style={{marginTop:18}}>حالة التكامل: غير متصل حالياً. لا يتم إرسال فواتير أو بيانات إلى الهيئة. مفاتيح API والشهادات لن تُخزن في هذه الشاشة؛ ستضاف لاحقاً عبر تخزين أسرار آمن.</div></section>;
}
