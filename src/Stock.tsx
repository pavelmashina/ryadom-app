import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Plus, Package, Settings } from "lucide-react";
import { Badge, Button, Card, Checkbox, Empty, SectionHeader } from "./components";
import { today, fmt, type Pet } from "./domain";
import { rpc, type AuthSession } from "./backend";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import {
  STOCK_UNITS, stockAmount, activeStockRule, stockForecast, stockProgress,
  stockStatus, stockRuleText, stockUnitFactor, compatibleStockUnits,
  type StockItem, type StockUnit,
} from "./stock-domain";
import "./stock.css";

type Mode = "list"|"create"|"detail"|"edit"|"operation"|"rule";
type Op = "add"|"manual_use"|"correction";
const categories = ["Корм", "Лакомства", "Препараты", "Витамины", "Уход", "Прочее"];
const errText = (e: unknown) => e instanceof Error ? e.message : "Ошибка связи";
function Field({ label, children }: {label: string; children: React.ReactNode}) {
 return <label className="stock-field"><span>{label}</span>{children}</label>;
}
export default function Stock({
 pet, session, onShop, onToggle, initialItemId,
}:{
 pet: Pet; session: AuthSession; initialItemId?: string;
 onShop:()=>void; onToggle:(id:string)=>void;
}) {
 const [items,setItems]=useState<StockItem[]>([]);
 const handledLink=useRef<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [mode,setMode]=useState<Mode>("list");
 const [editorReturn,setEditorReturn]=useState<"list"|"detail">("list");
 const [operation,setOperation]=useState<Op>("add");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [unit,setUnit]=useState<StockUnit>("г");
 const [startDate,setStartDate]=useState(today());
 const [draft,setDraft]=useState<RecurrenceDraft>(()=>({...draftForDate(today()),frequency:"daily"}));
 const [ruleEnabled,setRuleEnabled]=useState(true);
 const [gearOpen,setGearOpen]=useState(false);
 const gearTrigger=useRef<HTMLButtonElement|null>(null);
 const gearPopover=useRef<HTMLDivElement|null>(null);
 const [gearPosition,setGearPosition]=useState({top:0,left:0,width:260});
 const [createTarget,setCreateTarget]=useState<"existing"|"new">("new");
 const [createItemId,setCreateItemId]=useState("");
 const current=items.find((i)=>i.id===selectedId);
 const active=current?activeStockRule(current):null;
 const load=useCallback(async()=>{
  try {
   const next=await rpc(session,"stock_snapshot",{p_pet:pet.id}) as StockItem[];
   setItems(next);
   setError("");
  } catch(e){setError(errText(e));}finally{setLoading(false);}
 },[pet.id,session]);
 useEffect(()=>{
  setItems([]);
  setSelectedId(null);
  setMode("list");
  setGearOpen(false);
  setLoading(true);
  void load();
  function refresh(){if(!document.hidden)void load();}
  window.addEventListener("focus",refresh);
  window.addEventListener("online",refresh);
  window.addEventListener("ryadom:stock-changed",refresh);
  document.addEventListener("visibilitychange",refresh);
  return ()=>{window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);
   window.removeEventListener("ryadom:stock-changed",refresh);
   document.removeEventListener("visibilitychange",refresh);};
 },[load]);
 useEffect(()=>{
  if(!gearOpen)return;
  const oldBody={
   position:document.body.style.position,top:document.body.style.top,
   width:document.body.style.width,overflow:document.body.style.overflow,
  };
  const oldHtmlOverflow=document.documentElement.style.overflow;
  const scrollY=window.scrollY;
  document.body.style.position="fixed";
  document.body.style.top="-"+scrollY+"px";
  document.body.style.width="100%";
  document.body.style.overflow="hidden";
  document.documentElement.style.overflow="hidden";
  function reposition(){
   const trigger=gearTrigger.current;
   if(!trigger)return;
   const rect=trigger.getBoundingClientRect();
   const width=Math.min(272,Math.max(0,window.innerWidth-24));
   const left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12));
   const height=gearPopover.current?.getBoundingClientRect().height??216;
   const below=window.innerHeight-rect.bottom-12;
   const top=below>=height||below>=rect.top-12
    ? Math.min(rect.bottom+6,Math.max(12,window.innerHeight-height-12))
    : Math.max(12,rect.top-height-6);
   setGearPosition({left,top,width});
  }
  function dismissOutside(e:PointerEvent){
   const target=e.target as Node;
   if(!gearTrigger.current?.contains(target)&&!gearPopover.current?.contains(target))setGearOpen(false);
  }
  function dismissEscape(e:KeyboardEvent){
   if(e.key==="Escape"){
    e.preventDefault();setGearOpen(false);
    gearTrigger.current?.focus({preventScroll:true});
   }
   if(e.key==="Tab"){
    const controls=Array.from(gearPopover.current?.querySelectorAll<HTMLElement>(
     'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
    )??[]);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  }
  reposition();
  gearPopover.current?.querySelector<HTMLInputElement>('[role="switch"]')?.focus();
  window.addEventListener("resize",reposition);
  document.addEventListener("scroll",reposition,true);
  document.addEventListener("pointerdown",dismissOutside);
  document.addEventListener("keydown",dismissEscape);
  return ()=>{
   window.removeEventListener("resize",reposition);
   document.removeEventListener("scroll",reposition,true);
   document.removeEventListener("pointerdown",dismissOutside);
   document.removeEventListener("keydown",dismissEscape);
   document.body.style.position=oldBody.position;
   document.body.style.top=oldBody.top;
   document.body.style.width=oldBody.width;
   document.body.style.overflow=oldBody.overflow;
   document.documentElement.style.overflow=oldHtmlOverflow;
   window.scrollTo({top:scrollY,behavior:"instant"});
  };
 },[gearOpen]);
 useEffect(()=>{
  if(!initialItemId||handledLink.current===initialItemId)return;
  if(!items.some(i=>i.id===initialItemId))return;
  handledLink.current=initialItemId;setSelectedId(initialItemId);setMode("detail");
 },[initialItemId,items]);
 async function mutate(action:string,data:Record<string,unknown>) {
  if(busy) return null;
  setBusy(true);setError("");
  try {
   const updated=await rpc(session,"stock_mutate",{p_pet:pet.id,p_action:action,p_data:data}) as StockItem[];
   setItems(updated);
   return updated;
  }catch(e){setError(errText(e));return null;}
  finally{setBusy(false);}
 }
 const closeDetails=()=>{setMode("list");setSelectedId(null);setGearOpen(false);setError("");};
 function openEditor(next:"edit"|"operation"|"rule",item:StockItem,origin:"list"|"detail"=(mode==="detail"?"detail":"list")){
  setEditorReturn(origin);
  setSelectedId(item.id);
  setGearOpen(false);
  setError("");
  setMode(next);
 }
 function leaveEditor(){
  setGearOpen(false);
  setError("");
  if(editorReturn==="list"){setMode("list");setSelectedId(null);}
  else setMode("detail");
 }
 function goBack(){
  if(mode==="list")return;
  if(mode==="create"||mode==="detail"){closeDetails();return;}
  leaveEditor();
 }
 function openOperation(item:StockItem,action:Op,origin:"list"|"detail"=(mode==="detail"?"detail":"list")){
  setOperation(action);
  setUnit(item.display_unit);
  openEditor("operation",item,origin);
 }
 function openAdd() {
  const target=(mode==="detail"&&current)?current:(items.find(i=>i.legacy_food)??items.find(i=>i.category==="Корм")??items[0]);
  setCreateTarget(target?"existing":"new");
  setCreateItemId(target?.id??"");
  setUnit(target?.display_unit??"г");
  setMode("create");
  setGearOpen(false);
  setError("");
 }
 async function toggleAuto(item:StockItem,enabled:boolean) {
  if(Boolean(activeStockRule(item))===enabled)return;
  const savedRule=activeStockRule(item)??item.rules[0];
  if(enabled&&!savedRule){setGearOpen(false);openRule(item);return;}
  await mutate("set_rule", {
   id:item.id,enabled,
   ...(enabled&&savedRule ? {
    amount:savedRule.amount/stockUnitFactor(item.display_unit),
    unit:item.display_unit,frequency:savedRule.frequency,
    interval:savedRule.interval_count,days_of_week:savedRule.days_of_week,
    day_of_month:savedRule.day_of_month,
    starts_on:today(),
    ends_on:savedRule.ends_on&&savedRule.ends_on>=today()?savedRule.ends_on:null,
   } : {}),
  });
 }
 async function onAddExisting(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const d=new FormData(e.currentTarget);
  const item=items.find(i=>i.id===createItemId);
  if(!item){setError("Выберите товар из списка.");return;}
  const updated=await mutate("add",{
   id:item.id,amount:Number(d.get("amount")),unit:String(d.get("unit")),
   note:String(d.get("note")||""),
  });
  if(updated)closeDetails();
 }

 function openRule(item:StockItem) {
  const rule=activeStockRule(item)??item.rules[0];
  const starts=rule?.starts_on??today();
  const value=draftForDate(starts);
  setDraft({...value,frequency:rule?.frequency??"daily",interval:rule?.interval_count??1,
    weekdays:rule?.days_of_week?.length?rule.days_of_week:value.weekdays,
    monthday:rule?.day_of_month??value.monthday,
    endType:rule?.ends_on?"date":"never",endDate:rule?.ends_on??""});
  setStartDate(rule?.enabled?today():starts);
  setUnit(item.display_unit);
  setRuleEnabled(Boolean(activeStockRule(item))||!rule);
  openEditor("rule",item);
 }
 function goDetail(item:StockItem) {setSelectedId(item.id);setGearOpen(false);setMode("detail");setError("");}
 async function onCreate(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const d=new FormData(e.currentTarget);
  const updated=await mutate("create",{
   name:String(d.get("name")??""),category:String(d.get("category")??"Прочее"),
   quantity:Number(d.get("quantity")),unit:String(d.get("unit")),
   threshold:Number(d.get("threshold")||0),note:String(d.get("note")||""),
   notifications:d.has("notifications")
  });
  if(updated)closeDetails();
 }
 async function onEdit(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();if(!current)return;
  const d=new FormData(e.currentTarget);
  const updated=await mutate("edit",{
   id:current.id,name:String(d.get("name")??""),category:String(d.get("category")??"Прочее"),
   unit:String(d.get("unit")),threshold:Number(d.get("threshold")||0),
   note:String(d.get("note")||""),notifications:d.has("notifications")
  });
  if(updated)leaveEditor();
 }
 async function onOperation(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();if(!current)return;
  const d=new FormData(e.currentTarget);
  const updated=await mutate(operation,{id:current.id,amount:Number(d.get("amount")),
   unit:String(d.get("unit")),note:String(d.get("note")||"")});
  if(updated)leaveEditor();
 }
 async function onRule(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();if(!current)return;
  if(ruleEnabled&&(draft.frequency==="once"||draft.frequency==="yearly")) {
   setError("Для списаний выберите дни, недели или месяцы.");return;
  }
  const d=new FormData(e.currentTarget);
  const updated=await mutate("set_rule",{id:current.id,enabled:ruleEnabled,
   amount:Number(d.get("amount")),unit:String(d.get("unit")),
   frequency:draft.frequency,interval:draft.interval,
   days_of_week:draft.weekdays,day_of_month:draft.monthday,
   starts_on:startDate,ends_on:draft.endType==="date"?draft.endDate:null});
  if(updated)leaveEditor();
 }
 const currentView=mode!=="list"&&mode!=="create"&&current;
 const groups=categories.concat([...new Set(items.map(i=>i.category))].filter(x=>!categories.includes(x)));
 const featured=items.find(i=>i.legacy_food)??items.find(i=>i.category==="Корм")??items[0];
 return <div className="stock-screen">
  {mode!=="list"&&(
   <div className="stock-top">
    <Button size="sm" variant="ghost" onClick={goBack}>
     <ArrowLeft/> Назад
    </Button>
   </div>
  )}
  {error&&<p className="stock-error" role="alert">{error}</p>}
  {mode==="list"&&<>
   {loading&&<p className="stock-muted">Загружаем запасы…</p>}
   {!loading&&!featured&&<Card variant="info" className="stock-featured">
    <span className="eyebrow">Корм · фактический остаток</span>
    <p className="stock-muted">Запасов пока нет. Добавьте первый товар, чтобы отслеживать расход и пополнения.</p>
    <Button fullWidth variant="primary" onClick={openAdd}>
     <Plus/> Добавить запас
    </Button>
   </Card>}
   {featured&&<Card variant="info" className="stock-featured">
    <div className="stock-eyebrow-row">
     <span className="eyebrow">{featured.name} · фактический остаток</span>
     <button type="button" className="stock-gear" aria-label={"Настройки запаса: "+featured.name}
      ref={gearTrigger} aria-haspopup="dialog" aria-expanded={gearOpen}
      aria-controls={gearOpen?"stock-featured-settings":undefined}
      onClick={()=>setGearOpen(open=>!open)}><Settings aria-hidden="true"/></button>
    </div>
    {gearOpen&&typeof document!=="undefined"&&createPortal(
     <div className="stock-settings-layer">
      <div className="stock-settings-backdrop" aria-hidden="true" onClick={()=>setGearOpen(false)}/>
      <div className="stock-gear-panel" id="stock-featured-settings" ref={gearPopover}
      role="dialog" aria-modal="true" aria-label={"Настройки запаса: "+featured.name}
      style={{top:gearPosition.top,left:gearPosition.left,width:gearPosition.width}}>
      <label className="stock-switch-row">
       <span>Автоматическое списание</span>
       <input type="checkbox" role="switch" className="stock-switch"
        checked={Boolean(activeStockRule(featured))} disabled={busy}
        onChange={e=>void toggleAuto(featured,e.target.checked)}/>
      </label>
      <button type="button" onClick={()=>{setGearOpen(false);openRule(featured);}}>Изменить расход</button>
      <button type="button" onClick={()=>openOperation(featured,"manual_use","list")}>Списать вручную</button>
      <button type="button" onClick={()=>goDetail(featured)}>История и параметры</button>
     </div>
     </div>,document.body)}
    <div className="stock-overview">
     <div className="stock-large">
      {stockAmount(featured.current_quantity,featured.display_unit)} <small>{featured.display_unit}</small>
     </div>
     <Badge><Package/>{stockForecast(featured,today())
      ? "≈ "+stockForecast(featured,today())!.days+" дн."
      : activeStockRule(featured)?"Прогноз недоступен":"Укажите расход"}</Badge>
    </div>
    <progress value={stockProgress(featured)} max={100}
     aria-label={"Остаток "+stockAmount(featured.current_quantity,featured.display_unit)+" "+featured.display_unit}/>
    <div className="spread stock-scale">
     <span>0 {featured.display_unit}</span>
     <span>{stockAmount(featured.reference_quantity,featured.display_unit)} {featured.display_unit} · ориентир</span>
    </div>
    {stockForecast(featured,today())&&<p className="stock-muted">
     Примерно до {fmt(stockForecast(featured,today())!.date)}
    </p>}
    {stockStatus(featured)!=="normal"&&<p className="stock-warning">
     {stockStatus(featured)==="empty"?"Запас закончился.":"Запас скоро закончится."}
    </p>}
    <Button fullWidth variant="primary" onClick={openAdd}><Plus/> Добавить запас</Button>
   </Card>}
   {featured&&stockStatus(featured)!=="normal"&&<p className="stock-notice">
    {stockStatus(featured)==="empty"?"Запас закончился. Пора пополнить.":"Запас скоро закончится. Проверьте остаток и запланируйте покупку."}
   </p>}
   {groups.map(category=>{
    const stocks=items.filter(i=>i.id!==featured?.id && i.category===category);
    if(!stocks.length)return null;
    return <section className="stock-section" key={category}>
     <SectionHeader title={category}/>
     <div className="stock-list">{stocks.map(item=>{
      const status=stockStatus(item);
      const forecast=stockForecast(item,today());
      return <button type="button" key={item.id} className={"stock-card stock-"+status}
       onClick={()=>goDetail(item)}>
       <div className="stock-card-head">
        <strong>{item.name}</strong>
        <span className="stock-card-quantity">{stockAmount(item.current_quantity,item.display_unit)} {item.display_unit}</span>
       </div>
       {(forecast||status!=="normal")&&<span className="stock-secondary">
        {forecast&&"≈"+forecast.days+" дн."}
        {status!=="normal"&&<em>{status==="empty"?"Закончился":"Скоро закончится"}</em>}
       </span>}
       <progress max={100} value={stockProgress(item)} aria-label={"Остаток "+stockProgress(item)+"%"} />
      </button>;
     })}</div>
    </section>;
   })}
   <section className="stock-section stock-shopping">
    <SectionHeader title="Купить">
     <span className="stock-shopping-count">{pet.shopping.filter(s=>!s.done).length} в списке</span>
    </SectionHeader>
    {pet.shopping.length?(
     <div className="stock-shopping-list">
      {pet.shopping.map(s=><Checkbox key={s.id} className={"shopping "+(s.done?"done":"")}
       checked={s.done} onChange={()=>onToggle(s.id)}
       label={<span>{s.name}<small>{s.quantity}</small></span>}/>)}
     </div>
    ):<Empty title="Всё есть дома">Добавляйте покупки по мере необходимости.</Empty>}
    <Button fullWidth variant="secondary" onClick={onShop}><Plus/> Добавить покупку</Button>
    <p className="stock-muted stock-shopping-help">При подтверждении покупки вы можете сразу внести купленный корм в запас. Повторное пополнение той же покупки не начисляется.</p>
   </section>
  </>}
  {mode==="create"&&<section className="stock-section">
   <h2>Добавить запас</h2>
   {items.length>0&&<div className="stock-add-modes" role="group" aria-label="Способ добавления">
    <label><input type="radio" name="add-target" checked={createTarget==="existing"}
     onChange={()=>{setCreateTarget("existing");setError("");const item=items.find(i=>i.id===createItemId)??items[0];setCreateItemId(item.id);setUnit(item.display_unit);}}/> В существующий</label>
    <label><input type="radio" name="add-target" checked={createTarget==="new"}
     onChange={()=>{setCreateTarget("new");setError("");setUnit("г");}}/> Новый товар</label>
   </div>}
   {createTarget==="existing"&&items.length>0 ? (
    <form className="stock-form" onSubmit={onAddExisting}>
     <Field label="Товар">
      <select value={createItemId} onChange={e=>{
       const item=items.find(i=>i.id===e.target.value);setCreateItemId(e.target.value);
       if(item)setUnit(item.display_unit);
      }}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
     </Field>
     <div className="stock-fields-two">
      <Field label="Количество"><input type="number" name="amount" min={0.001} step="0.001" required/></Field>
      <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
       {compatibleStockUnits((items.find(i=>i.id===createItemId)??items[0]).display_unit).map(x=><option key={x}>{x}</option>)}
      </select></Field>
     </div>
     <Field label="Комментарий"><textarea name="note" rows={2}/></Field>
     <Button fullWidth type="submit" loading={busy}>Добавить запас</Button>
    </form>
   ) : (
   <form className="stock-form" onSubmit={onCreate}>
    <Field label="Название"><input name="name" maxLength={120} required placeholder="Например, Royal Canin Mini"/></Field>
    <Field label="Категория"><select name="category">{categories.map(x=><option key={x}>{x}</option>)}</select></Field>
    <div className="stock-fields-two">
     <Field label="Количество"><input name="quantity" type="number" min={0} step="0.001" required/></Field>
     <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
      {STOCK_UNITS.map(x=><option key={x}>{x}</option>)}</select></Field>
    </div>
    <Field label={"Порог низкого запаса, "+unit}><input name="threshold" type="number" min={0} step="0.001" defaultValue={0}/></Field>
    <Field label="Комментарий"><textarea name="note" rows={2} maxLength={3000}/></Field>
    <label className="stock-check"><input type="checkbox" name="notifications" defaultChecked/> Уведомлять о низком запасе</label>
    <Button fullWidth type="submit" disabled={busy} loading={busy}>Создать запас</Button>
   </form>
   )}
  </section>}
  {currentView&&<section className="stock-section">
   {mode==="detail"&&<>
    <h2 className="stock-detail-title">{current.name}</h2>
    <Card variant="info" className="stock-detail-card">
     <span className="eyebrow">Фактический остаток</span>
     <div className="stock-overview">
      <div className="stock-large">
       {stockAmount(current.current_quantity,current.display_unit)} <small>{current.display_unit}</small>
      </div>
      <Badge><Package/>{stockForecast(current,today())
       ? "≈ "+stockForecast(current,today())!.days+" дн."
       : active?"Прогноз недоступен":"Укажите расход"}</Badge>
     </div>
     <progress value={stockProgress(current)} max={100}
      aria-label={"Остаток "+stockAmount(current.current_quantity,current.display_unit)+" "+current.display_unit}/>
     <div className="spread stock-scale">
      <span>0 {current.display_unit}</span>
      <span>{stockAmount(current.reference_quantity,current.display_unit)} {current.display_unit} · ориентир</span>
     </div>
     {stockForecast(current,today())&&<p className="stock-muted">Примерно до {fmt(stockForecast(current,today())!.date)}</p>}
     {stockStatus(current)!=="normal"&&<p className="stock-warning">
      {stockStatus(current)==="empty"?"Запас закончился":"Запас скоро закончится"}</p>}
     {current.note&&<p className="stock-muted">{current.note}</p>}
     <Button fullWidth variant="primary" onClick={openAdd}><Plus/> Добавить запас</Button>
     <div className="stock-detail-actions">
      <Button variant="secondary" onClick={()=>{setOperation("manual_use");setUnit(current.display_unit);setMode("operation");}}>Списать</Button>
      <Button variant="ghost" onClick={()=>{setOperation("correction");setUnit(current.display_unit);setMode("operation");}}>Скорректировать остаток</Button>
     </div>
    </Card>
    <section className="stock-section">
     <SectionHeader title="Автоматическое списание"/>
     <Card className="stock-setting-card">
      <label className="stock-switch-row">
       <span>Автоматическое списание</span>
       <input type="checkbox" role="switch" className="stock-switch" checked={Boolean(active)}
        disabled={busy} onChange={e=>void toggleAuto(current,e.target.checked)}/>
      </label>
      <p className="stock-muted">{active?stockRuleText(active):current.rules.length
       ? "Расход: "+stockRuleText(current.rules[0]):"Для начала задайте расход."}</p>
      <Button size="sm" variant="secondary" onClick={()=>openRule(current)}>Изменить расход</Button>
     </Card>
     <div className="stock-actions">
      <Button variant="ghost" onClick={()=>{setUnit(current.display_unit);setMode("edit");}}>Редактировать товар</Button>
      <Button variant="ghost" onClick={async()=>{if(!window.confirm("Архивировать запас? История сохранится."))return;
       const updated=await mutate("archive",{id:current.id});if(updated)closeDetails();}}>Архивировать</Button>
     </div>
    </section>
    <section className="stock-section">
     <SectionHeader title="История операций"/>
     {!current.transactions.length&&<p className="stock-muted">Операций пока нет.</p>}
     <div className="stock-history">{current.transactions.map(t=><div className="stock-transaction" key={t.id}>
      <div><strong>{t.type==="add"?"Пополнение":t.type==="manual_use"?"Ручное списание":
       t.type==="automatic_use"?"Автоматическое списание":"Корректировка"}</strong>
       <span>{new Date(t.occurred_at).toLocaleDateString("ru-RU")}</span>
       {t.comment&&<small>{t.comment}</small>}
       {t.shortage>0&&<small>Не хватило: {stockAmount(t.shortage,current.display_unit)} {current.display_unit}</small>}
      </div>
      <b>{t.direction==="out"?"−":"+"}{stockAmount(t.applied_amount,current.display_unit)} {current.display_unit}</b>
     </div>)}</div>
    </section>
   </>}
   {mode==="edit"&&<>
    <h2>Редактировать запас</h2>
    <form className="stock-form" onSubmit={onEdit}>
     <Field label="Название"><input name="name" defaultValue={current.name} maxLength={120} required/></Field>
     <Field label="Категория"><select name="category" defaultValue={current.category}>
      {[...new Set([...categories,current.category])].map(x=><option key={x}>{x}</option>)}</select></Field>
     <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
      {compatibleStockUnits(current.display_unit).map(x=><option key={x}>{x}</option>)}</select></Field>
     <Field label={"Порог низкого запаса, "+unit} key={unit}>
      <input type="number" name="threshold" min={0} step="0.001"
      defaultValue={current.low_stock_threshold/(unit==="кг"||unit==="л"?1000:1)}/></Field>
     <Field label="Комментарий"><textarea name="note" rows={2} defaultValue={current.note}/></Field>
     <label className="stock-check"><input name="notifications" type="checkbox" defaultChecked={current.notifications_enabled}/>
      Уведомлять о низком запасе</label>
     <Button type="submit" loading={busy}>Сохранить</Button>
    </form>
   </>}
   {mode==="operation"&&<>
    <h2>{operation==="add"?"Пополнить":operation==="manual_use"?"Списать":"Скорректировать остаток"}</h2>
    <p className="stock-muted">Сейчас: {stockAmount(current.current_quantity,current.display_unit)} {current.display_unit}</p>
    <form className="stock-form" onSubmit={onOperation}>
     <div className="stock-fields-two">
      <Field label={operation==="correction"?"Фактический остаток":"Количество"}>
       <input name="amount" type="number" min={operation==="correction"?0:0.001} step="0.001" required/></Field>
      <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
       {compatibleStockUnits(current.display_unit).map(x=><option key={x}>{x}</option>)}</select></Field>
     </div>
     <Field label="Комментарий"><textarea name="note" rows={2}/></Field>
     <Button type="submit" loading={busy}>Подтвердить</Button>
    </form>
   </>}
   {mode==="rule"&&<>
    <h2>Расход корма</h2>
    <form className="stock-form" onSubmit={onRule}>
     <label className="stock-switch-row">
      <span>Автоматическое списание</span>
      <input type="checkbox" role="switch" className="stock-switch" checked={ruleEnabled}
       onChange={e=>setRuleEnabled(e.target.checked)}/>
     </label>
     <div className="stock-fields-two">
       <Field label="Списывать"><input name="amount" type="number" min={0.001} step="0.001"
        defaultValue={(active??current.rules[0])?
         (active??current.rules[0]).amount/(current.display_unit==="кг"||current.display_unit==="л"?1000:1):undefined} required/></Field>
       <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
        {compatibleStockUnits(current.display_unit).map(x=><option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Начиная с"><input type="date" value={startDate} required
       onChange={e=>setStartDate(e.target.value)}/></Field>
      <RecurrenceFields date={startDate} value={draft} onChange={setDraft}
       allowedFrequencies={["daily","weekly","monthly"]} allowCount={false}/>
      <p className="stock-muted">{ruleEnabled
       ? "При сохранении списание включится. История уже выполненных операций останется."
       : "Расход сохранится, но автоматическое списание останется выключенным."}</p>
     <Button type="submit" loading={busy}>Сохранить правило</Button>
    </form>
   </>}
  </section>}
 </div>;
}
