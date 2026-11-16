import { useEffect, useState } from "react";

type AdminRequest = {
  id:string; request_number:string; request_type:"purchase"|"administrative";
  title:string; description?:string; supplier_name?:string; estimated_amount?:string;
  priority:string; status:"pending"|"approved"|"rejected"|"fulfilled";
  requester_name?:string; created_at:string; decision_note?:string;
};
type CustodyAsset = {
  id:string; asset_number:string; asset_name:string; serial_number?:string;
  assignee_name?:string; status:"assigned"|"returned"|"damaged";
  condition_note?:string; assigned_at:string; returned_at?:string;
};
type Props = {token:string; role:string};
const requestStatus:Record<string,string>={pending:"بانتظار الموافقة",approved:"معتمد",rejected:"مرفوض",fulfilled:"تم التنفيذ"};
const assetStatus:Record<string,string>={assigned:"بعهدة الموظف",returned:"تم الإرجاع",damaged:"تالف"};

export default function AdminServices({token,role}:Props) {
  const [requests,setRequests]=useState<AdminRequest[]>([]);
  const [assets,setAssets]=useState<CustodyAsset[]>([]);
  const [users,setUsers]=useState<Array<{id:string;full_name:string;email:string}>>([]);
  const [requestForm,setRequestForm]=useState({request_type:"purchase",title:"",description:"",supplier_name:"",estimated_amount:"",priority:"normal"});
  const [assetForm,setAssetForm]=useState({asset_name:"",serial_number:"",assigned_to:"",condition_note:""});
  const [decisionNotes,setDecisionNotes]=useState<Record<string,string>>({});
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const manager=role==="admin"||role==="manager";

  const load=async()=>{
    const headers={Authorization:"Bearer "+token};
    const [r,a]=await Promise.all([fetch("/api/admin/requests",{headers}),fetch("/api/admin/custody",{headers})]);
    const rd=await r.json(), ad=await a.json();
    if(!r.ok)throw new Error(rd.error||"تعذر تحميل الطلبات");
    if(!a.ok)throw new Error(ad.error||"تعذر تحميل سجل العهد");
    setRequests(rd.requests||[]);setAssets(ad.assets||[]);
    if(manager){
      const u=await fetch("/api/users",{headers});const ud=await u.json();
      if(!u.ok)throw new Error(ud.error||"تعذر تحميل الموظفين");
      setUsers((ud.users||[]).filter((x:{active:boolean})=>x.active));
    }
  };
  useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"تعذر تحميل البيانات"));},[token,role]);

  const createRequest=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);setError("");
    try{
      const r=await fetch("/api/admin/requests",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({...requestForm,estimated_amount:requestForm.estimated_amount===""?undefined:Number(requestForm.estimated_amount)})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر إنشاء الطلب");
      setRequests(v=>[d.request,...v]);setRequestForm({request_type:"purchase",title:"",description:"",supplier_name:"",estimated_amount:"",priority:"normal"});
    }catch(e){setError(e instanceof Error?e.message:"تعذر إنشاء الطلب");}finally{setBusy(false);}
  };
  const decide=async(id:string,status:"approved"|"rejected"|"fulfilled")=>{
    setError("");
    try{
      const r=await fetch("/api/admin/requests/"+id+"/status",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({status,decision_note:decisionNotes[id]||""})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث الطلب");
      setRequests(v=>v.map(x=>x.id===id?{...x,...d.request}:x));
    }catch(e){setError(e instanceof Error?e.message:"تعذر تحديث الطلب");}
  };
  const assignAsset=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);setError("");
    try{
      const r=await fetch("/api/admin/custody",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(assetForm)});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تسجيل العهدة");
      setAssets(v=>[d.asset,...v]);setAssetForm({asset_name:"",serial_number:"",assigned_to:"",condition_note:""});
    }catch(e){setError(e instanceof Error?e.message:"تعذر تسجيل العهدة");}finally{setBusy(false);}
  };
  const returnAsset=async(id:string,status:"returned"|"damaged")=>{
    setError("");
    try{
      const r=await fetch("/api/admin/custody/"+id+"/status",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({status})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث العهدة");
      setAssets(v=>v.map(x=>x.id===id?{...x,...d.asset}:x));
    }catch(e){setError(e instanceof Error?e.message:"تعذر تحديث العهدة");}
  };

  return <section className="tasks-panel">
    <div className="section-kicker">الخدمات الداخلية والمشتريات</div>
    <h2>الخدمات الإدارية والمشتريات</h2>
    <p>قدّم طلب شراء أو خدمة إدارية، وتابع الموافقات والعهد المسجلة على الموظفين.</p>
    {error&&<div className="auth-error">{error}</div>}
    <h3>إنشاء طلب جديد</h3>
    <form className="task-create" onSubmit={createRequest} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
      <select value={requestForm.request_type} onChange={e=>setRequestForm(v=>({...v,request_type:e.target.value}))}>
        <option value="purchase">طلب شراء</option><option value="administrative">خدمة إدارية</option>
      </select>
      <input required minLength={3} maxLength={200} placeholder="عنوان الطلب" value={requestForm.title} onChange={e=>setRequestForm(v=>({...v,title:e.target.value}))}/>
      <input maxLength={180} placeholder="المورد (اختياري)" value={requestForm.supplier_name} onChange={e=>setRequestForm(v=>({...v,supplier_name:e.target.value}))}/>
      <input type="number" min="0" step="0.01" placeholder="التكلفة التقديرية (ر.س)" value={requestForm.estimated_amount} onChange={e=>setRequestForm(v=>({...v,estimated_amount:e.target.value}))}/>
      <select value={requestForm.priority} onChange={e=>setRequestForm(v=>({...v,priority:e.target.value}))}>
        <option value="normal">عادية</option><option value="low">منخفضة</option><option value="high">مرتفعة</option><option value="urgent">عاجلة</option>
      </select>
      <textarea required maxLength={5000} placeholder="تفاصيل الطلب ومبرراته" value={requestForm.description} onChange={e=>setRequestForm(v=>({...v,description:e.target.value}))} style={{gridColumn:"1 / -1",minHeight:90,padding:12,font:"inherit"}}/>
      <button disabled={busy}>{busy?"جارٍ الإرسال...":"إرسال الطلب"}</button>
    </form>

    <div className="section-kicker" style={{marginTop:28}}>طلبات الشراء والخدمات</div>
    <div className="task-list">
      {requests.map(x=><article className="task-row" key={x.id}>
        <div style={{minWidth:0,flex:1}}>
          <strong>{x.request_number} · {x.title}</strong>
          <small>{x.request_type==="purchase"?"شراء":"خدمة إدارية"} · {x.requester_name||"مستخدم"} · {new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"}).format(new Date(x.created_at))}</small>
          <small>{x.estimated_amount?Number(x.estimated_amount).toLocaleString("ar-SA")+" ر.س · ":""}{x.supplier_name||""} · {requestStatus[x.status]}</small>
          {x.description&&<details><summary style={{cursor:"pointer"}}>التفاصيل</summary><p style={{whiteSpace:"pre-wrap"}}>{x.description}</p></details>}
          {x.decision_note&&<small>ملاحظة القرار: {x.decision_note}</small>}
        </div>
        {manager&&x.status==="pending"&&<div style={{display:"grid",gap:6}}>
          <input aria-label="ملاحظة القرار" placeholder="ملاحظة اختيارية" value={decisionNotes[x.id]||""} onChange={e=>setDecisionNotes(v=>({...v,[x.id]:e.target.value}))}/>
          <div style={{display:"flex",gap:6}}><button type="button" onClick={()=>decide(x.id,"approved")}>موافقة</button><button type="button" onClick={()=>decide(x.id,"rejected")}>رفض</button></div>
        </div>}
        {manager&&x.status==="approved"&&<button type="button" onClick={()=>decide(x.id,"fulfilled")}>تأكيد التنفيذ</button>}
        {!manager&&<small>{requestStatus[x.status]}</small>}
      </article>)}
      {requests.length===0&&<div className="empty-state">لا توجد طلبات مسجلة.</div>}
    </div>

    {manager&&<>
      <div className="section-kicker" style={{marginTop:30}}>تسجيل عهدة جديدة</div>
      <form className="task-create" onSubmit={assignAsset} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
        <input required minLength={2} maxLength={180} placeholder="اسم الأصل أو الجهاز" value={assetForm.asset_name} onChange={e=>setAssetForm(v=>({...v,asset_name:e.target.value}))}/>
        <input maxLength={120} placeholder="الرقم التسلسلي" value={assetForm.serial_number} onChange={e=>setAssetForm(v=>({...v,serial_number:e.target.value}))}/>
        <select required value={assetForm.assigned_to} onChange={e=>setAssetForm(v=>({...v,assigned_to:e.target.value}))}>
          <option value="">اختر الموظف المستلم</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name} · {u.email}</option>)}
        </select>
        <input maxLength={1000} placeholder="حالة الأصل وملاحظات التسليم" value={assetForm.condition_note} onChange={e=>setAssetForm(v=>({...v,condition_note:e.target.value}))}/>
        <button disabled={busy||!assetForm.assigned_to}>تسجيل وتسليم العهدة</button>
      </form>
    </>}
    <div className="section-kicker" style={{marginTop:28}}>سجل العهد</div>
    <div className="task-list">
      {assets.map(x=><article className="task-row" key={x.id}>
        <div><strong>{x.asset_number} · {x.asset_name}</strong><small>{x.assignee_name||"غير محدد"}{x.serial_number?" · "+x.serial_number:""}</small><small>{assetStatus[x.status]}{x.condition_note?" · "+x.condition_note:""}</small></div>
        {manager&&x.status==="assigned"&&<div style={{display:"flex",gap:6}}><button type="button" onClick={()=>returnAsset(x.id,"returned")}>تم الإرجاع</button><button type="button" onClick={()=>returnAsset(x.id,"damaged")}>تالف</button></div>}
      </article>)}
      {assets.length===0&&<div className="empty-state">لا توجد عهد مسجلة.</div>}
    </div>
  </section>;
}
