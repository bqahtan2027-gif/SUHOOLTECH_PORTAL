import {useCallback,useEffect,useMemo,useState} from "react";
import {RefreshCw,ShoppingCart,Truck,Receipt,FileCheck2} from "lucide-react";

type Row=Record<string,any>;
type Props={token:string|null;role:string};
export default function Procurement({token,role}:Props){
 const manager=role==="admin"||role==="manager";
 const [requests,setRequests]=useState<Row[]>([]),[orders,setOrders]=useState<Row[]>([]),[receipts,setReceipts]=useState<Row[]>([]),[invoices,setInvoices]=useState<Row[]>([]);
 const [suppliers,setSuppliers]=useState<Row[]>([]),[items,setItems]=useState<Row[]>([]),[warehouses,setWarehouses]=useState<Row[]>([]),[accounts,setAccounts]=useState<Row[]>([]);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [request,setRequest]=useState({purpose:"",description:"",quantity:"1",price:"0"});
 const [order,setOrder]=useState({supplier_id:"",item_id:"",description:"",quantity:"1",unit_price:"0",tax_rate:"15"});
 const [receipt,setReceipt]=useState({order_id:"",warehouse_id:"",line_id:"",quantity:"1",unit_cost:""});
 const [invoice,setInvoice]=useState({order_id:"",invoice_number:"",invoice_date:new Date().toISOString().slice(0,10),line_id:"",quantity:"1",unit_price:"0",tax_rate:"15"});
 const [posting,setPosting]=useState({invoice_id:"",payable_account_id:"",inventory_account_id:"",input_tax_account_id:""});
 const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
 const selectedOrder=useMemo(()=>orders.find(x=>x.id===receipt.order_id),[orders,receipt.order_id]);
 const invoiceOrder=useMemo(()=>orders.find(x=>x.id===invoice.order_id),[orders,invoice.order_id]);
 const selectedInvoice=useMemo(()=>invoices.find(x=>x.id===posting.invoice_id),[invoices,posting.invoice_id]);
 const load=useCallback(async()=>{
  if(!token)return;setError("");
  try{
   const req=await fetch("/api/procurement/requests",{headers});const rd=await req.json();if(!req.ok)throw new Error(rd.error||"تعذر تحميل طلبات الشراء");setRequests(rd.requests||[]);
   if(manager){
    const urls=["/api/procurement/orders","/api/procurement/goods-receipts","/api/procurement/supplier-invoices","/api/finance/parties","/api/inventory/items","/api/inventory/warehouses","/api/finance/accounts"];
    const rs=await Promise.all(urls.map(u=>fetch(u,{headers})));const ds=await Promise.all(rs.map(r=>r.json()));
    const bad=rs.findIndex(r=>!r.ok);if(bad>=0)throw new Error(ds[bad].error||"تعذر تحميل بيانات دورة المشتريات");
    setOrders(ds[0].orders||[]);setReceipts(ds[1].receipts||[]);setInvoices(ds[2].invoices||[]);setSuppliers((ds[3].parties||[]).filter((x:Row)=>["supplier","both"].includes(x.party_type)));setItems(ds[4].items||[]);setWarehouses(ds[5].warehouses||[]);setAccounts(ds[6].accounts||[]);
   }
  }catch(e){setError(e instanceof Error?e.message:"تعذر تحميل المشتريات");}
 },[token,role]);
 useEffect(()=>{void load();},[load]);
 const post=async(url:string,body:unknown)=>{
  setBusy(true);setError("");
  try{const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تنفيذ العملية");await load();return true;}
  catch(e){setError(e instanceof Error?e.message:"تعذر تنفيذ العملية");return false;}
  finally{setBusy(false);}
 };
 const decision=async(id:string,status:string)=>{
  setBusy(true);try{const r=await fetch("/api/procurement/requests/"+id+"/decision",{method:"PATCH",headers,body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحديث الطلب");await load();}
  catch(e){setError(e instanceof Error?e.message:"تعذر تحديث الطلب");}finally{setBusy(false);}
 };
 const inputStyle={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10};
 const field=(value:string,onChange:(v:string)=>void,placeholder:string,type="text")=><input required placeholder={placeholder} type={type} value={value} onChange={e=>onChange(e.target.value)}/>;
 return <section className="tasks-panel">
  <div className="section-kicker">دورة التوريد والموردين</div><h2><ShoppingCart size={22} style={{verticalAlign:"middle",marginLeft:8}}/>المشتريات والموردون</h2>
  <p>من طلب الشراء إلى أمر الشراء والاستلام وفاتورة المورد والترحيل المحاسبي.</p>{error&&<div className="auth-error">{error}</div>}
  <h3>طلب شراء جديد</h3>
  <form className="task-create" style={inputStyle} onSubmit={e=>{e.preventDefault();void post("/api/procurement/requests",{purpose:request.purpose,lines:[{description:request.description,quantity:Number(request.quantity),estimated_unit_price:Number(request.price)}]}).then(ok=>{if(ok)setRequest({purpose:"",description:"",quantity:"1",price:"0"});});}}>
   {field(request.purpose,v=>setRequest(x=>({...x,purpose:v})),"الغرض من الشراء")}
   {field(request.description,v=>setRequest(x=>({...x,description:v})),"الصنف أو الخدمة")}
   {field(request.quantity,v=>setRequest(x=>({...x,quantity:v})),"الكمية","number")}
   {field(request.price,v=>setRequest(x=>({...x,price:v})),"السعر التقديري","number")}
   <button disabled={busy}>إرسال طلب الشراء</button>
  </form>
  <h3>طلبات الشراء والاعتمادات</h3><div className="task-list">{requests.map(x=><article className="task-row" key={x.id}><div><strong>{x.request_number} · {x.purpose}</strong><small>{x.requester_name||"مقدم الطلب"} · {x.status}</small></div>{manager&&x.status==="pending"&&<div><button disabled={busy} onClick={()=>void decision(x.id,"approved")}>اعتماد</button> <button disabled={busy} onClick={()=>void decision(x.id,"rejected")}>رفض</button></div>}</article>)}{!requests.length&&<div className="empty-state">لا توجد طلبات شراء.</div>}</div>
  {manager&&<>
   <h3><FileCheck2 size={18} style={{verticalAlign:"middle",marginLeft:6}}/>إصدار أمر شراء</h3>
   <form className="task-create" style={inputStyle} onSubmit={e=>{e.preventDefault();void post("/api/procurement/orders",{supplier_id:order.supplier_id,lines:[{item_id:order.item_id||undefined,description:order.description,quantity:Number(order.quantity),unit_price:Number(order.unit_price),tax_rate:Number(order.tax_rate)}]});}}>
    <select required value={order.supplier_id} onChange={e=>setOrder(x=>({...x,supplier_id:e.target.value}))}><option value="">اختر المورد</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <select value={order.item_id} onChange={e=>{const x=items.find(i=>i.id===e.target.value);setOrder(v=>({...v,item_id:e.target.value,description:x?.name||v.description,unit_price:x?.cost_price??v.unit_price}));}}><option value="">خدمة / صنف غير مخزني</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select>
    {field(order.description,v=>setOrder(x=>({...x,description:v})),"وصف البند")}
    {field(order.quantity,v=>setOrder(x=>({...x,quantity:v})),"الكمية","number")}
    {field(order.unit_price,v=>setOrder(x=>({...x,unit_price:v})),"سعر الوحدة","number")}
    {field(order.tax_rate,v=>setOrder(x=>({...x,tax_rate:v})),"الضريبة %","number")}
    <button disabled={busy||!suppliers.length}>إصدار أمر الشراء</button>
   </form>
   <h3>أوامر الشراء والاستلام</h3>
   <div className="task-list">{orders.map(x=><article className="task-row" key={x.id}><div><strong>{x.order_number} · {x.supplier_display_name||x.supplier_name}</strong><small>{x.status} · الإجمالي {Number(x.total).toLocaleString("ar-SA")} ر.س</small>{(x.lines||[]).map((l:Row)=><small key={l.id}>{l.description}: مستلم {l.received_quantity} من {l.quantity}</small>)}</div></article>)}{!orders.length&&<div className="empty-state">لا توجد أوامر شراء.</div>}</div>
   <h3><Truck size={18} style={{verticalAlign:"middle",marginLeft:6}}/>استلام بضاعة للمستودع</h3>
   <form className="task-create" style={inputStyle} onSubmit={e=>{e.preventDefault();void post("/api/procurement/orders/"+receipt.order_id+"/receive",{warehouse_id:receipt.warehouse_id,lines:[{order_line_id:receipt.line_id,quantity:Number(receipt.quantity),unit_cost:receipt.unit_cost===""?undefined:Number(receipt.unit_cost)}]});}}>
    <select required value={receipt.order_id} onChange={e=>setReceipt(x=>({...x,order_id:e.target.value,line_id:""}))}><option value="">اختر أمر الشراء</option>{orders.filter(x=>["sent","partially_received"].includes(x.status)).map(x=><option key={x.id} value={x.id}>{x.order_number} · {x.supplier_name}</option>)}</select>
    <select required value={receipt.line_id} onChange={e=>setReceipt(x=>({...x,line_id:e.target.value}))}><option value="">اختر البند</option>{(selectedOrder?.lines||[]).filter((l:Row)=>Number(l.received_quantity)<Number(l.quantity)).map((l:Row)=><option key={l.id} value={l.id}>{l.description} · متبقي {Number(l.quantity)-Number(l.received_quantity)}</option>)}</select>
    <select required value={receipt.warehouse_id} onChange={e=>setReceipt(x=>({...x,warehouse_id:e.target.value}))}><option value="">اختر المستودع</option>{warehouses.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
    {field(receipt.quantity,v=>setReceipt(x=>({...x,quantity:v})),"كمية الاستلام","number")}
    <button disabled={busy||!warehouses.length}>تسجيل الاستلام وتحديث المخزون</button>
   </form>
   <h3>سندات الاستلام</h3><div className="task-list">{receipts.map(x=><article className="task-row" key={x.id}><div><strong>{x.receipt_number} · {x.order_number}</strong><small>{x.warehouse_name} · {new Date(x.received_at).toLocaleString("ar-SA")}</small></div></article>)}{!receipts.length&&<div className="empty-state">لا توجد سندات استلام.</div>}</div>
   <h3><Receipt size={18} style={{verticalAlign:"middle",marginLeft:6}}/>تسجيل فاتورة مورد</h3>
   <form className="task-create" style={inputStyle} onSubmit={e=>{e.preventDefault();void post("/api/procurement/supplier-invoices",{purchase_order_id:invoice.order_id,supplier_invoice_number:invoice.invoice_number,invoice_date:invoice.invoice_date,lines:[{purchase_order_line_id:invoice.line_id,quantity:Number(invoice.quantity),unit_price:Number(invoice.unit_price),tax_rate:Number(invoice.tax_rate)}]});}}>
    <select required value={invoice.order_id} onChange={e=>setInvoice(x=>({...x,order_id:e.target.value,line_id:""}))}><option value="">اختر أمر الشراء</option>{orders.filter(x=>["partially_received","received"].includes(x.status)).map(x=><option key={x.id} value={x.id}>{x.order_number} · {x.supplier_name}</option>)}</select>
    {field(invoice.invoice_number,v=>setInvoice(x=>({...x,invoice_number:v})),"رقم فاتورة المورد")}
    <input type="date" required value={invoice.invoice_date} onChange={e=>setInvoice(x=>({...x,invoice_date:e.target.value}))}/>
    <select required value={invoice.line_id} onChange={e=>{const l=(invoiceOrder?.lines||[]).find((a:Row)=>a.id===e.target.value);setInvoice(x=>({...x,line_id:e.target.value,unit_price:String(l?.unit_price??x.unit_price)}));}}><option value="">اختر البند المستلم</option>{(invoiceOrder?.lines||[]).filter((l:Row)=>Number(l.received_quantity)>0).map((l:Row)=><option key={l.id} value={l.id}>{l.description} · مستلم {l.received_quantity}</option>)}</select>
    {field(invoice.quantity,v=>setInvoice(x=>({...x,quantity:v})),"الكمية المفوترة","number")}
    {field(invoice.unit_price,v=>setInvoice(x=>({...x,unit_price:v})),"سعر الوحدة","number")}
    {field(invoice.tax_rate,v=>setInvoice(x=>({...x,tax_rate:v})),"الضريبة %","number")}
    <button disabled={busy}>حفظ فاتورة المورد كمسودة</button>
   </form>
   <h3>فواتير الموردين</h3><div className="task-list">{invoices.map(x=><article className="task-row" key={x.id}><div><strong>{x.internal_number} · {x.supplier_invoice_number}</strong><small>{x.supplier_name} · {Number(x.total).toLocaleString("ar-SA")} ر.س · {x.status}{x.entry_number?" · قيد "+x.entry_number:""}</small></div></article>)}{!invoices.length&&<div className="empty-state">لا توجد فواتير موردين.</div>}</div>
   <h3>ترحيل فاتورة المورد إلى دفتر الأستاذ</h3>
   <form className="task-create" style={inputStyle} onSubmit={e=>{e.preventDefault();void post("/api/procurement/supplier-invoices/"+posting.invoice_id+"/post",{payable_account_id:posting.payable_account_id,inventory_account_id:posting.inventory_account_id,input_tax_account_id:posting.input_tax_account_id});}}>
    <select required value={posting.invoice_id} onChange={e=>setPosting(x=>({...x,invoice_id:e.target.value}))}><option value="">اختر فاتورة مسودة</option>{invoices.filter(x=>x.status==="draft").map(x=><option key={x.id} value={x.id}>{x.internal_number} · {x.supplier_invoice_number} · {x.total} ر.س</option>)}</select>
    <select required value={posting.payable_account_id} onChange={e=>setPosting(x=>({...x,payable_account_id:e.target.value}))}><option value="">حساب الموردين (التزامات)</option>{accounts.filter(x=>x.account_type==="liability").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <select required value={posting.inventory_account_id} onChange={e=>setPosting(x=>({...x,inventory_account_id:e.target.value}))}><option value="">حساب المخزون (أصول)</option>{accounts.filter(x=>x.account_type==="asset").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <select required value={posting.input_tax_account_id} onChange={e=>setPosting(x=>({...x,input_tax_account_id:e.target.value}))}><option value="">حساب ضريبة المدخلات (أصول)</option>{accounts.filter(x=>x.account_type==="asset").map(x=><option key={x.id} value={x.id}>{x.account_code} · {x.account_name}</option>)}</select>
    <button disabled={busy||!selectedInvoice}>ترحيل الفاتورة وإنشاء القيد</button>
   </form>
  </>}
  <button className="secondary-button" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> تحديث البيانات</button>
 </section>;
}
