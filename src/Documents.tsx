import { useEffect, useState } from "react";

type DocumentRecord = {
  id: string;
  document_number: string;
  title: string;
  document_type: "contract" | "policy" | "letter" | "nda" | "other";
  party_name?: string;
  content: string;
  status: "draft" | "review" | "approved" | "rejected" | "archived";
  created_at: string;
};

type Props = { token: string; role: string };

const typeLabels: Record<string,string> = {
  contract: "عقد", policy: "سياسة", letter: "خطاب", nda: "اتفاقية سرية", other: "أخرى"
};
const statusLabels: Record<string,string> = {
  draft: "مسودة", review: "بانتظار المراجعة", approved: "معتمد",
  rejected: "يحتاج تعديلاً", archived: "مؤرشف"
};

export default function Documents({ token, role }: Props) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [form, setForm] = useState({title:"",document_type:"contract",party_name:"",content:""});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manager = role === "admin" || role === "manager";

  const load = async () => {
    const response = await fetch("/api/documents", {headers:{Authorization:"Bearer "+token}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر تحميل المستندات");
    setDocuments(data.documents || []);
  };

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : "تعذر تحميل المستندات"));
  }, [token]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents", {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إنشاء المستند");
      setDocuments(current => [data.document, ...current]);
      setForm({title:"",document_type:"contract",party_name:"",content:""});
    } catch(e) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء المستند");
    } finally { setBusy(false); }
  };

  const changeStatus = async (id:string,status:string) => {
    setError("");
    try {
      const response = await fetch("/api/documents/"+id+"/status", {
        method:"PATCH",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({status})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تحديث المستند");
      setDocuments(current => current.map(item => item.id === id ? {...item,...data.document} : item));
    } catch(e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث المستند");
    }
  };

  return <section className="tasks-panel">
    <div className="section-kicker">الحوكمة وإدارة الملفات</div>
    <h2>المستندات والعقود</h2>
    <p>أنشئ المستندات، أرسلها للمراجعة، اعتمدها ثم احفظها في الأرشيف.</p>
    {error && <div className="auth-error">{error}</div>}
    <form className="task-create" onSubmit={create} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
      <input required minLength={3} maxLength={200} placeholder="عنوان المستند أو العقد" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/>
      <select value={form.document_type} onChange={e=>setForm(v=>({...v,document_type:e.target.value}))}>
        <option value="contract">عقد</option><option value="policy">سياسة داخلية</option>
        <option value="letter">خطاب</option><option value="nda">اتفاقية سرية</option><option value="other">أخرى</option>
      </select>
      <input maxLength={180} placeholder="الطرف الآخر (اختياري)" value={form.party_name} onChange={e=>setForm(v=>({...v,party_name:e.target.value}))}/>
      <textarea required minLength={1} maxLength={30000} placeholder="محتوى المستند أو ملخص بنوده..." value={form.content} onChange={e=>setForm(v=>({...v,content:e.target.value}))} style={{gridColumn:"1 / -1",minHeight:120,border:"1px solid #e2e9f1",borderRadius:8,padding:12,font:"inherit"}}/>
      <button disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ المستند كمسودة"}</button>
    </form>
    <div className="section-kicker" style={{marginTop:28}}>سجل المستندات</div>
    <div className="task-list">
      {documents.map(doc=><article className="task-row" key={doc.id}>
        <div style={{minWidth:0,flex:1}}>
          <strong>{doc.document_number} · {doc.title}</strong>
          <small>{typeLabels[doc.document_type]}{doc.party_name ? " · "+doc.party_name : ""} · {new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"}).format(new Date(doc.created_at))}</small>
          <small>{statusLabels[doc.status]}</small>
          <details style={{marginTop:8}}>
            <summary style={{cursor:"pointer",fontSize:11,color:"#1769c5"}}>عرض المحتوى</summary>
            <p style={{whiteSpace:"pre-wrap",fontSize:11,lineHeight:1.9,color:"#52647a"}}>{doc.content}</p>
          </details>
        </div>
        {manager && <select aria-label="إجراء المستند" value={doc.status} onChange={e=>changeStatus(doc.id,e.target.value)}>
          {doc.status==="draft" && <><option value="draft">مسودة</option><option value="review">إرسال للمراجعة</option></>}
          {doc.status==="review" && <><option value="review">بانتظار المراجعة</option><option value="approved">اعتماد</option><option value="rejected">إرجاع للتعديل</option></>}
          {doc.status==="rejected" && <><option value="rejected">يحتاج تعديلاً</option><option value="draft">إعادة كمسودة</option></>}
          {doc.status==="approved" && <><option value="approved">معتمد</option><option value="archived">أرشفة</option></>}
          {doc.status==="archived" && <option value="archived">مؤرشف</option>}
        </select>}
        {!manager && <small>{statusLabels[doc.status]}</small>}
      </article>)}
      {documents.length===0 && <div className="empty-state">لا توجد مستندات حتى الآن.</div>}
    </div>
  </section>;
}
