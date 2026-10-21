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
import { stockBackDestination, type StockEditorOrigin, type StockViewMode } from "./stock-navigation";
import "./stock.css";

type Mode = StockViewMode;
type Op = "add"|"manual_use"|"correction";
const categories = ["Корм", "Лакомства", "Препараты", "Витамины", "Уход", "Прочее"];
const errText = (e: unknown) => e instanceof Error ? e.message : "Ошибка связи";
function Field({ label, children }: {label: string; children: React.ReactNode}) {
 return <label className="stock-field"><span>{label}</span>{children}</label>;
}
export default function Stock({
 pet, session, onShop, onToggle, initialItemId, onInitialItemHandled,
}:{
 pet: Pet; session: AuthSession; initialItemId?: string; onInitialItemHandled?:()=>void;
 onShop:()=>void; onToggle:(id:string)=>void;
}) {
 const [items,setItems]=useState<StockItem[]>([]);
 const loadEpoch=useRef(0);
 const activePetId=useRef(pet.id);
 activePetId.current=pet.id;
 const handledLink=useRef<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [mode,setMode]=useState<Mode>("list");
 const [editorReturn,setEditorReturn]=useState<StockEditorOrigin>("list");
 const [operation,setOperation]=useState<Op>("add");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [unit,setUnit]=useState<StockUnit>("г");
 const [startDate,setStartDate]=useState(today());
 const [draft,setDraft]=useState<RecurrenceDraft>(()=>({...draftForDate(today()),frequency:"daily"}));
 const [ruleEnabled,setRuleEnabled]=useState(true);
 const [gearOpen,setGearOpen]=useState(false);
 const [settingsItemId,setSettingsItemId]=useState<string|null>(null);
 const gearTrigger=useRef<HTMLButtonElement|null>(null);
 const gearPopover=useRef<HTMLDivElement|null>(null);
 const [gearPosition,setGearPosition]=useState({top:0,left:0,width:260});
 const [createTarget,setCreateTarget]=useState<"existing"|"new">("new");
 const [createItemId,setCreateItemId]=useState("");
 const visibleItems=items.filter(item=>item.pet_id===pet.id);
 const current=visibleItems.find((i)=>i.id===selectedId);
 const active=current?activeStockRule(current):null;
 const settingsItem=visibleItems.find((i)=>i.id===settingsItemId);
 const load=useCallback(async()=>{
  const epoch=++loadEpoch.current;
  try {
   const next=await rpc(session,"stock_snapshot",{p_pet:pet.id}) as StockItem[];
   if(epoch!==loadEpoch.current||activePetId.current!==pet.id)return;
   setItems(next);
   setError("");
  }catch(e){
   if(epoch===loadEpoch.current&&activePetId.current===pet.id)setError(errText(e));
  }finally{
   if(epoch===loadEpoch.current&&activePetId.current===pet.id)setLoading(false);
  }
 },[pet.id,session]);
 useEffect(()=>{
  setItems([]);
  setSelectedId(null);
  setMode("list");
  setEditorReturn("list");
  setGearOpen(false);
  setSettingsItemId(null);
  setLoading(true);
  void load();
  function refresh(){if(!document.hidden)void load();}
  window.addEventListener("focus",refresh);
  window.addEventListener("online",refresh);
  window.addEventListener("ryadom:stock-changed",refresh);
  document.addEventListener("visibilitychange",refresh);
  return ()=>{
   ++loadEpoch.current;
   window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);
   window.removeEventListener("ryadom:stock-changed",refresh);
   document.removeEventListener("visibilitychange",refresh);
  };
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
  (gearPopover.current?.querySelector<HTMLElement>('[role="switch"]') ??
   gearPopover.current?.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
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
   if(document.contains(gearTrigger.current))gearTrigger.current?.focus({preventScroll:true});
  };
 },[gearOpen]);
 useEffect(()=>{
  if(!initialItemId||handledLink.current===initialItemId)return;
  if(!visibleItems.some(i=>i.id===initialItemId))return;
  handledLink.current=initialItemId;setSelectedId(initialItemId);setMode("detail");
  onInitialItemHandled?.();
 },[initialItemId,visibleItems,onInitialItemHandled]);
 async function mutate(action:string,data:Record<string,unknown>) {
  if(busy) return null;
  setBusy(true);setError("");
  try {
   const targetPetId=pet.id;
   const updated=await rpc(session,"stock_mutate",{p_pet:targetPetId,p_action:action,p_data:data}) as StockItem[];
   if(activePetId.current!==targetPetId)return null;
   ++loadEpoch.current;
   setItems(updated);
   return updated;
  }catch(e){setError(errText(e));return null;}
  finally{setBusy(false);}
 }
 const closeDetails=()=>{setMode("list");setSelectedId(null);setGearOpen(false);setSettingsItemId(null);setError("");};
 function showStockMenu(item:StockItem|null,button:HTMLButtonElement){
  gearTrigger.current=button;
  setSettingsItemId(item?.id??null);
  setGearOpen(true);
  setError("");
 }
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
  if(stockBackDestination(mode,editorReturn)==="list"){closeDetails();return;}
  leaveEditor();
 }
 function openOperation(item:StockItem,action:Op,origin:"list"|"detail"=(mode==="detail"?"detail":"list")){
  setOperation(action);
  setUnit(item.display_unit);
  openEditor("operation",item,origin);
 }
 function openAdd() {
  const target=(mode==="detail"&&current)?current:(visibleItems.find(i=>i.legacy_food)??visibleItems.find(i=>i.category==="Корм")??visibleItems[0]);
  setCreateTarget(mode==="detail"&&current?"existing":"new");
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
  const item=visibleItems.find(i=>i.id===createItemId);
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
   <section className="stock-section">
    <div className="stock-list-header">
     <h2>Запасы</h2>
     <button type="button" className="stock-add-trigger"
      aria-label="Добавить запас или покупку" aria-haspopup="dialog"
      aria-expanded={gearOpen&&settingsItemId===null}
      aria-controls={gearOpen&&settingsItemId===null?"stock-action-menu":undefined}
      onClick={e=>showStockMenu(null,e.currentTarget)}>
      <Plus aria-hidden="true"/>
     </button>
    </div>
    <Card variant="info" className="stock-collection">
     {loading&&<p className="stock-muted">Загружаем запасы…</p>}
     {!loading&&!visibleItems.length&&<p className="stock-muted">
      Пока нет запасов. Нажмите «+», чтобы добавить первый товар.
     </p>}
     {visibleItems.map(item=>{
      const forecast=stockForecast(item,today());
      const status=stockStatus(item);
      return <div className={"stock-item stock-"+status} key={item.id}>
       <div className="stock-item-top">
        <button type="button" className="stock-item-open"
         onClick={()=>goDetail(item)} aria-label={"Открыть запас: "+item.name}>
         <strong className="stock-item-name">{item.name}</strong>
         <span className="stock-item-category">{item.category}</span>
        </button>
        <strong className="stock-item-balance">
         {stockAmount(item.current_quantity,item.display_unit)} {item.display_unit}
        </strong>
        <button type="button" className="stock-gear"
         aria-label={"Настройки запаса: "+item.name}
         aria-haspopup="dialog" aria-expanded={gearOpen&&settingsItemId===item.id}
         aria-controls={gearOpen&&settingsItemId===item.id?"stock-action-menu":undefined}
         onClick={e=>showStockMenu(item,e.currentTarget)}>
         <Settings aria-hidden="true"/>
        </button>
       </div>
       <progress max={100} value={stockProgress(item)}
        aria-label={"Остаток "+item.name+": "+stockAmount(item.current_quantity,item.display_unit)+" "+item.display_unit}/>
       <div className="stock-item-footer">
        <span>{forecast?"Примерно на "+forecast.days+" дн.":""}</span>
        {status!=="normal"&&<em>{status==="empty"?"Закончился":"Скоро закончится"}</em>}
       </div>
      </div>;
     })}
    </Card>
   </section>
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
    <p className="stock-muted stock-shopping-help">Купленный корм можно сразу внести в запас при подтверждении покупки.</p>
   </section>
   {gearOpen&&typeof document!=="undefined"&&createPortal(
    <div className="stock-settings-layer">
     <div className="stock-settings-backdrop" aria-hidden="true" onClick={()=>setGearOpen(false)}/>
     <div className="stock-gear-panel" id="stock-action-menu" ref={gearPopover}
      role="dialog" aria-modal="true"
      aria-label={settingsItem?"Настройки запаса: "+settingsItem.name:"Добавить"}
      style={{top:gearPosition.top,left:gearPosition.left,width:gearPosition.width}}>
      {settingsItem ? <>
       <label className="stock-switch-row">
        <span>Автоматическое списание</span>
        <input type="checkbox" role="switch" className="stock-switch"
         checked={Boolean(activeStockRule(settingsItem))} disabled={busy}
         onChange={e=>void toggleAuto(settingsItem,e.target.checked)}/>
       </label>
       <button type="button" onClick={()=>{setGearOpen(false);openRule(settingsItem);}}>Изменить расход</button>
       <button type="button" onClick={()=>openOperation(settingsItem,"manual_use","list")}>Списать вручную</button>
       <button type="button" onClick={()=>goDetail(settingsItem)}>История и параметры</button>
      </> : <>
       <button type="button" onClick={()=>{setGearOpen(false);openAdd();}}>Добавить запас</button>
       <button type="button" onClick={()=>{setGearOpen(false);onShop();}}>Добавить покупку</button>
      </>}
     </div>
    </div>,document.body)}
  </>}
  {mode==="create"&&<section className="stock-section">
   <h2>Добавить запас</h2>
   {visibleItems.length>0&&<div className="stock-add-modes" role="group" aria-label="Способ добавления">
    <label><input type="radio" name="add-target" checked={createTarget==="existing"}
     onChange={()=>{setCreateTarget("existing");setError("");const item=visibleItems.find(i=>i.id===createItemId)??visibleItems[0];setCreateItemId(item.id);setUnit(item.display_unit);}}/> В существующий</label>
    <label><input type="radio" name="add-target" checked={createTarget==="new"}
     onChange={()=>{setCreateTarget("new");setError("");setUnit("г");}}/> Новый товар</label>
   </div>}
   {createTarget==="existing"&&visibleItems.length>0 ? (
    <form className="stock-form" onSubmit={onAddExisting}>
     <Field label="Товар">
      <select value={createItemId} onChange={e=>{
       const item=visibleItems.find(i=>i.id===e.target.value);setCreateItemId(e.target.value);
       if(item)setUnit(item.display_unit);
      }}>{visibleItems.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
     </Field>
     <div className="stock-fields-two">
      <Field label="Количество"><input type="number" name="amount" min={0.001} step="0.001" required/></Field>
      <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
       {compatibleStockUnits((visibleItems.find(i=>i.id===createItemId)??visibleItems[0]).display_unit).map(x=><option key={x}>{x}</option>)}
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
     <div className="stock-detail-actions">
      <Button variant="secondary" onClick={()=>openOperation(current,"manual_use","detail")}>Списать</Button>
      <Button variant="ghost" onClick={()=>openOperation(current,"correction","detail")}>Скорректировать остаток</Button>
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
      <Button variant="ghost" onClick={()=>{setUnit(current.display_unit);openEditor("edit",current,"detail");}}>Редактировать товар</Button>
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
