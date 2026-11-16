import {useCallback,useEffect,useState} from "react";
import {Receipt,RefreshCw} from "lucide-react";
type Row=Record<string,any>;
export default function SalesInvoices({token,role}:{token:string|null;role:string}){
 const canManage=role==="admin"||role==="manager";
 const [invoices,setInvoices]=useState<Row[]>([]),[parties,setParties]=useState<Row[]>([]),[accounts,setAccounts]=useState<Row[]>([]),[items,setItems]=useState<Row[]>([]),[warehouses,setWarehouses]=useState<Row[]>([]),[receipts,setReceipts]=useState<Row[]>([]);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({party_id:"",issue_date:new Date().toISOString().slice(0,10),due_date:"",warehouse_id:"",item_id:"",description:"",quantity:"1",unit_price:"0",tax_rate:"15",discount_amount:"0"});
 const [posting,setPosting]=useState({invoice_id:"",receivable_account_id:"",revenue_account_id:"",output_tax_account_id:""});
 const [receipt,setReceipt]=useState({invoice_id:"",amount:"",payment_method:"bank_transfer",payment_account_id:"",reference_number:""});
 const [statementCustomer,setStatementCustomer]=useState(""),[statementFrom,setStatementFrom]=useState(""),[statementTo,setStatementTo]=useState(""),[statement,setStatement]=useState<Row|null>(null);
 const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
 const load=useCallback(async()=>{
  if(!token)return;
  try{
   const urls=["/api/finance/sales-invoices","/api/finance/parties","/api/finance/accounts","/api/inventory/items","/api/inventory/warehouses","/api/finance/customer-receipts"];
   const rs=await Promise.all(urls.map(u=>fetch(u,{headers}))),ds=await Promise.all(rs.map(r=>r.json()));
   const bad=rs.findIndex(r=>!r.ok);if(bad>=0)throw new Error(ds[bad].error||"تعذر تحميل الفواتير");
   setInvoices(ds[0].invoices||[]);setParties((ds[1].parties||[]).filter((x:Row)=>["customer","both"].includes(x.party_type)));
   setAccounts(ds[2].accounts||[]);setItems(ds[3].items||[]);setWarehouses(ds[4].warehouses||[]);setReceipts(ds[5].receipts||[]);
  }catch(e){setError(e instanceof Error?e.message:"تعذر تحميل الفواتير");}
 },[token]);
 useEffect(()=>{void load();},[load]);
 const send=async(url:string,body:unknown)=>{
  setBusy(true);setError("");
  try{const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تنفيذ العملية");await load();return true;}
  catch(e){setError(e instanceof Error?e.message:"تعذر تنفيذ العملية");return false;}
  finally{setBusy(false);}
 };
 const field=(key:keyof typeof form,placeholder:string,type="text")=><input required placeholder={placeholder} type={type} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/>;
 return <section className="tasks-panel">
  <div className="section-kicker">المبيعات والحسابات المدينة</div><h2><Receipt size={22} style={{verticalAlign:"middle",marginLeft:8}}/>فواتير المبيعات</h2>
  <p>إنشاء فاتورة عميل، إصدارها، خصم الكميات المخزنية وإنشاء قيد محاسبي متوازن. الفاتورة تبقى مسودة حتى إصدارها.</p>
  {error&&<div className="auth-error">{error}</div>}
  {canManage&&<>
   <h3>إنشاء فاتورة جديدة</h3>
   <form className="task-create" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}} onSubmit={e=>{e.preventDefault();void send("/api/finance/sales-invoices",{party_id:form.party_id,issue_date:form.issue_date,due_date:form.due_date||undefined,warehouse_id:form.warehouse_id||undefined,discount_amount:Number(form.discount_amount),lines:[{item_id:form.item_id||undefined,description:form.description,quantity:Number(form.quantity),unit_price:Number(form.unit_price),tax_rate:Number(form.tax_rate)}]}).then(ok=>{if(ok)setForm(v=>({...v,description:"",quantity:"1",unit_price:"0",discount_amount:"0"}));});}}>
    <select required value={form.party_id} onChange={e=>setForm(v=>({...v,party_id:e.target.value}))}><option value="">اختر العميل</option>{parties.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <input required type="date" value={form.issue_date} onChange={e=>setForm(v=>({...v,issue_date:e.target.value}))}/>
    <input type="date" value={form.due_date} onChange={e=>setForm(v=>({...v,due_date:e.target.value}))}/>
    <select value={form.warehouse_id} onChange={e=>setForm(v=>({...v,warehouse_id:e.target.value}))}><option value="">بدون مستودع (خدمة / غير مخزني)</option>{warehouses.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <select value={form.item_id} onChange={e=>{const x=items.find(i=>i.id===e.target.value);setForm(v=>({...v,item_id:e.target.value,description:x?.name||v.description,unit_price:String(x?.sale_price??v.unit_price)}));}}><option value="">خدمة أو بند غير مخزني</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select>
    {field("description","وصف البند")}
    {field("quantity","الكمية","number")}{field("unit_price","سعر الوحدة","number")}{field("tax_rate","الضريبة %","number")}{field("discount_amount","الخصم","number")}
    <button disabled={busy||!parties.length}>حفظ الفاتورة كمسودة</button>
   </form>
   <h3>إصدار الفواتير وترحيلها</h3>
   <form className="task-create" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}} onSubmit={e=>{e.preventDefault();void send("/api/finance/sales-invoices/"+posting.invoice_id+"/post",{receivable_account_id:posting.receivable_account_id,revenue_account_id:posting.revenue_account_id,output_tax_account_id:posting.output_tax_account_id});}}>
    <select required value={posting.invoice_id} onChange={e=>setPosting(v=>({...v,invoice_id:e.target.value}))}><option value="">اختر فاتورة مسودة</option>{invoices.filter(x=>x.status==="draft").map(x=><option key={x.id} value={x.id}>{x.invoice_number} · {x.customer_name} · {x.total} ر.س</option>)}</select>
    <select required value={posting.receivable_account_id} onChange={e=>setPosting(v=>({...v,receivable_account_id:e.target.value}))}><option value="">حساب العملاء (أصول)</option>{accounts.filter(x=>x.account_type==="asset").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <select required value={posting.revenue_account_id} onChange={e=>setPosting(v=>({...v,revenue_account_id:e.target.value}))}><option value="">حساب الإيرادات</option>{accounts.filter(x=>x.account_type==="revenue").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <select required value={posting.output_tax_account_id} onChange={e=>setPosting(v=>({...v,output_tax_account_id:e.target.value}))}><option value="">ضريبة المخرجات (التزامات)</option>{accounts.filter(x=>x.account_type==="liability").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <button disabled={busy}>إصدار الفاتورة وتحديث المخزون والحسابات</button>
   </form>
  </>}
  <h3>سجل فواتير المبيعات</h3>
  <div className="task-list">{invoices.map(x=><article className="task-row" key={x.id}><div><strong>{x.invoice_number} · {x.customer_name}</strong><small>{x.issue_date} · {Number(x.total).toLocaleString("ar-SA")} ر.س · {x.status==="issued"?"صادرة":x.status==="draft"?"مسودة":x.status}</small><small>المحصل {Number(x.paid_amount||0).toLocaleString("ar-SA")} ر.س · المتبقي {Math.max(0,Number(x.total)-Number(x.paid_amount||0)).toLocaleString("ar-SA")} ر.س</small>{x.journal_entry_id&&<small>قيد {x.entry_number||"مرحّل"} {x.stock_document_number?"· صرف "+x.stock_document_number:""}</small>}</div></article>)}{!invoices.length&&<div className="empty-state">لا توجد فواتير مبيعات.</div>}</div>
  {canManage&&<>
   <h3>تسجيل سند قبض</h3>
   <form className="task-create" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}} onSubmit={e=>{e.preventDefault();void send("/api/finance/customer-receipts",{invoice_id:receipt.invoice_id,amount:Number(receipt.amount),payment_method:receipt.payment_method,payment_account_id:receipt.payment_account_id,reference_number:receipt.reference_number||undefined}).then(ok=>{if(ok)setReceipt(v=>({...v,amount:"",reference_number:""}));});}}>
    <select required value={receipt.invoice_id} onChange={e=>setReceipt(v=>({...v,invoice_id:e.target.value}))}><option value="">اختر فاتورة مستحقة</option>{invoices.filter(x=>["issued","partially_paid"].includes(x.status)).map(x=><option key={x.id} value={x.id}>{x.invoice_number} · {x.customer_name} · متبقي {Math.max(0,Number(x.total)-Number(x.paid_amount||0)).toFixed(2)} ر.س</option>)}</select>
    <input required type="number" min="0.01" step="0.01" placeholder="مبلغ القبض" value={receipt.amount} onChange={e=>setReceipt(v=>({...v,amount:e.target.value}))}/>
    <select required value={receipt.payment_method} onChange={e=>setReceipt(v=>({...v,payment_method:e.target.value}))}><option value="bank_transfer">تحويل بنكي</option><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="other">أخرى</option></select>
    <select required value={receipt.payment_account_id} onChange={e=>setReceipt(v=>({...v,payment_account_id:e.target.value}))}><option value="">اختر حساب الصندوق أو البنك</option>{accounts.filter(x=>x.account_type==="asset").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <input placeholder="رقم مرجع التحويل (اختياري)" value={receipt.reference_number} onChange={e=>setReceipt(v=>({...v,reference_number:e.target.value}))}/>
    <button disabled={busy||!invoices.some(x=>["issued","partially_paid"].includes(x.status))}>حفظ سند القبض وترحيل القيد</button>
   </form>
  </>}
  <h3>كشف حساب العميل</h3>
  <form className="task-create" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}} onSubmit={async e=>{e.preventDefault();setError("");setStatement(null);try{const qs=new URLSearchParams();if(statementFrom)qs.set("from",statementFrom);if(statementTo)qs.set("to",statementTo);const r=await fetch("/api/finance/parties/"+statementCustomer+"/statement?"+qs.toString(),{headers});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل كشف الحساب");setStatement(d);}catch(err){setError(err instanceof Error?err.message:"تعذر تحميل كشف الحساب");}}}>
   <select required value={statementCustomer} onChange={e=>setStatementCustomer(e.target.value)}><option value="">اختر العميل</option>{parties.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <input type="date" aria-label="من تاريخ" value={statementFrom} onChange={e=>setStatementFrom(e.target.value)}/>
   <input type="date" aria-label="إلى تاريخ" value={statementTo} onChange={e=>setStatementTo(e.target.value)}/>
   <button disabled={!statementCustomer}>عرض كشف الحساب</button>
  </form>
  {statement&&<><div className="task-row"><strong>{statement.party?.name} · رصيد افتتاحي {Number(statement.opening_balance||0).toLocaleString("ar-SA")} ر.س · رصيد ختامي {Number(statement.closing_balance||0).toLocaleString("ar-SA")} ر.س</strong></div><div className="task-list">{(statement.transactions||[]).map((x:Row)=><article className="task-row" key={x.id}><div><strong>{x.reference} · {x.description}</strong><small>{String(x.transaction_date).slice(0,10)} · مدين {Number(x.debit).toFixed(2)} · دائن {Number(x.credit).toFixed(2)} · الرصيد {Number(x.running_balance).toFixed(2)} ر.س</small></div></article>)}{!statement.transactions?.length&&<div className="empty-state">لا توجد حركات خلال الفترة المحددة.</div>}</div></>}
  <h3>سجل سندات القبض</h3><div className="task-list">{receipts.map(x=><article className="task-row" key={x.id}><div><strong>{x.receipt_number} · {x.customer_name||"عميل"}</strong><small>{x.invoice_number||"بدون فاتورة"} · {Number(x.amount).toLocaleString("ar-SA")} ر.س · {x.payment_method==="cash"?"نقدي":x.payment_method==="bank_transfer"?"تحويل بنكي":x.payment_method==="card"?"بطاقة":"أخرى"}</small><small>{x.entry_number?"القيد "+x.entry_number:"قيد محاسبي مرتبط"}</small></div></article>)}{!receipts.length&&<div className="empty-state">لا توجد سندات قبض.</div>}</div>
  <button className="secondary-button" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/> تحديث البيانات</button>
 </section>;
}
