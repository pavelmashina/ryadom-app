import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { Button, Checkbox } from "./components";
import { today, fmt, type Pet } from "./domain";
import { rpc, type AuthSession } from "./backend";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import {
  STOCK_UNITS, stockAmount, activeStockRule, stockForecast, stockProgress,
  stockStatus, stockRuleText, compatibleStockUnits,
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
 pet, session, onShop, onToggle,
}:{
 pet: Pet; session: AuthSession;
 onShop:()=>void; onToggle:(id:string)=>void;
}) {
 const [items,setItems]=useState<StockItem[]>([]);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [mode,setMode]=useState<Mode>("list");
 const [operation,setOperation]=useState<Op>("add");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [unit,setUnit]=useState<StockUnit>("г");
 const [startDate,setStartDate]=useState(today());
 const [draft,setDraft]=useState<RecurrenceDraft>(()=>({...draftForDate(today()),frequency:"daily"}));
 const [ruleEnabled,setRuleEnabled]=useState(true);
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
  void load();
  function refresh(){if(!document.hidden)void load();}
  window.addEventListener("focus",refresh);
  window.addEventListener("online",refresh);
  document.addEventListener("visibilitychange",refresh);
  return ()=>{window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);
   document.removeEventListener("visibilitychange",refresh);};
 },[load]);
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
 const closeDetails=()=>{setMode("list");setSelectedId(null);setError("");};
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
  setSelectedId(item.id);setMode("rule");setError("");
 }
 function goDetail(item:StockItem) {setSelectedId(item.id);setMode("detail");setError("");}
 async function onCreate(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const d=new FormData(e.currentTarget);
  const originalIds=new Set(items.map((i)=>i.id));
  const updated=await mutate("create",{
   name:String(d.get("name")??""),category:String(d.get("category")??"Прочее"),
   quantity:Number(d.get("quantity")),unit:String(d.get("unit")),
   threshold:Number(d.get("threshold")||0),note:String(d.get("note")||""),
   notifications:d.has("notifications")
  });
  if(!updated)return;
  const item=updated.find((i)=>!originalIds.has(i.id));
  if(!item){setMode("list");return;}
  if(d.has("auto"))openRule(item);
  else goDetail(item);
 }
 async function onEdit(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();if(!current)return;
  const d=new FormData(e.currentTarget);
  const updated=await mutate("edit",{
   id:current.id,name:String(d.get("name")??""),category:String(d.get("category")??"Прочее"),
   unit:String(d.get("unit")),threshold:Number(d.get("threshold")||0),
   note:String(d.get("note")||""),notifications:d.has("notifications")
  });
  if(updated)setMode("detail");
 }
 async function onOperation(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();if(!current)return;
  const d=new FormData(e.currentTarget);
  const updated=await mutate(operation,{id:current.id,amount:Number(d.get("amount")),
   unit:String(d.get("unit")),note:String(d.get("note")||"")});
  if(updated)setMode("detail");
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
  if(updated)setMode("detail");
 }
 const currentView=mode!=="list"&&mode!=="create"&&current;
 const groups=categories.concat([...new Set(items.map(i=>i.category))].filter(x=>!categories.includes(x)));
 return <div className="stock-screen">
  <div className="stock-top">
   {mode==="list"?<h1>Запасы</h1>:<Button size="sm" variant="ghost"
     onClick={()=>currentView?setMode("detail"):closeDetails()}><ArrowLeft/> Назад</Button>}
   {mode==="list"&&<Button size="sm" variant="secondary" onClick={()=>{setMode("create");setError("");}}>
     <Plus/> Добавить запас</Button>}
  </div>
  {error&&<p className="stock-error" role="alert">{error}</p>}
  {mode==="list"&&<>
   {loading&&<p className="stock-muted">Загружаем запасы…</p>}
   {!loading&&!items.length&&<p className="stock-muted">Запасы пока не добавлены. Создайте первый товар.</p>}
   {groups.map(category=>{
    const stocks=items.filter(i=>i.category===category);
    if(!stocks.length)return null;
    return <section className="stock-section" key={category}>
     <h2>{category}</h2>
     <div className="stock-list">{stocks.map(item=>{
      const status=stockStatus(item),rule=activeStockRule(item);
      const forecast=stockForecast(item,today());
      return <button type="button" key={item.id} className={"stock-card stock-"+status}
       onClick={()=>goDetail(item)}>
       <strong>{item.name}</strong>
       <span className="stock-primary">{stockAmount(item.current_quantity,item.display_unit)} {item.display_unit}
        {forecast&&<span> · ≈{forecast.days} дн.</span>}</span>
       <span className="stock-secondary">{rule?stockRuleText(rule):"Автосписание выключено"}
        {status!=="normal"&&<em>{status==="empty"?"Закончился":"Скоро закончится"}</em>}</span>
       <progress max={100} value={stockProgress(item)} aria-label={"Остаток "+stockProgress(item)+"%"} />
      </button>;
     })}</div>
    </section>;
   })}
   <section className="stock-section">
    <h2>Купить</h2>
    <div className="stock-list">
     {pet.shopping.map(s=><Checkbox key={s.id} className={"shopping "+(s.done?"done":"")}
      checked={s.done} onChange={()=>onToggle(s.id)}
      label={<span>{s.name}<small>{s.quantity}</small></span>}/>)}
     {!pet.shopping.length&&<p className="stock-muted">Список покупок пуст.</p>}
    </div>
    <Button fullWidth variant="secondary" onClick={onShop}><Plus/> Добавить покупку</Button>
    <p className="stock-muted">При подтверждении покупки вы можете сразу внести купленный корм в запас. Повторное пополнение той же покупки не начисляется.</p>
   </section>
  </>}
  {mode==="create"&&<section className="stock-section">
   <h2>Новый запас</h2>
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
    <label className="stock-check"><input type="checkbox" name="auto"/> Настроить автоматическое списание после создания</label>
    <Button fullWidth type="submit" disabled={busy} loading={busy}>Создать запас</Button>
   </form>
  </section>}
  {currentView&&<section className="stock-section">
   {mode==="detail"&&<>
    <h2>{current.name}</h2>
    <div className="stock-detail-card">
     <span className="stock-muted">Фактический остаток</span>
     <div className="stock-balance">{stockAmount(current.current_quantity,current.display_unit)} {current.display_unit}</div>
     {stockStatus(current)!=="normal"&&<p className="stock-warning">
      {stockStatus(current)==="empty"?"Запас закончился":"Запас скоро закончится"}</p>}
     {stockForecast(current,today())&&<p className="stock-muted">
      Примерно до {fmt(stockForecast(current,today())!.date)}</p>}
     <progress value={stockProgress(current)} max={100}/>
     <p className="stock-muted">{active?stockRuleText(active):"Автоматическое списание выключено"}</p>
     {current.note&&<p>{current.note}</p>}
    </div>
    <div className="stock-actions">
     <Button onClick={()=>{setOperation("add");setUnit(current.display_unit);setMode("operation");}}>Пополнить</Button>
     <Button onClick={()=>{setOperation("manual_use");setUnit(current.display_unit);setMode("operation");}}>Списать</Button>
     <Button variant="ghost" onClick={()=>{setOperation("correction");setUnit(current.display_unit);setMode("operation");}}>Скорректировать остаток</Button>
    </div>
    <h2>Автоматическое списание</h2>
    <div className="stock-detail-card">
     <p>{active?stockRuleText(active):"Выключено"}</p>
     {active&&<p className="stock-muted">Начиная с {fmt(active.starts_on)}</p>}
     <Button size="sm" variant="secondary" onClick={()=>openRule(current)}>
      {active?"Изменить правило":"Настроить списание"}</Button>
    </div>
    <div className="stock-actions">
     <Button variant="ghost" onClick={()=>{setUnit(current.display_unit);setMode("edit");}}>Редактировать товар</Button>
     <Button variant="ghost" onClick={async()=>{if(!window.confirm("Архивировать запас? История сохранится."))return;
      const updated=await mutate("archive",{id:current.id});if(updated)closeDetails();}}>Архивировать</Button>
    </div>
    <h2>История операций</h2>
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
    <h2>Автоматическое списание</h2>
    <form className="stock-form" onSubmit={onRule}>
     <label className="stock-check"><input type="checkbox" checked={ruleEnabled}
      onChange={e=>setRuleEnabled(e.target.checked)}/> Включено</label>
     {ruleEnabled&&<>
      <div className="stock-fields-two">
       <Field label="Списывать"><input name="amount" type="number" min={0.001} step="0.001"
        defaultValue={active?active.amount/(current.display_unit==="кг"||current.display_unit==="л"?1000:1):undefined} required/></Field>
       <Field label="Единица"><select name="unit" value={unit} onChange={e=>setUnit(e.target.value as StockUnit)}>
        {compatibleStockUnits(current.display_unit).map(x=><option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Начиная с"><input type="date" value={startDate} required
       onChange={e=>setStartDate(e.target.value)}/></Field>
      <RecurrenceFields date={startDate} value={draft} onChange={setDraft}
       allowedFrequencies={["daily","weekly","monthly"]} allowCount={false}/>
      <p className="stock-muted">Изменение правила сохраняет историю предыдущих списаний.</p>
     </>}
     <Button type="submit" loading={busy}>Сохранить правило</Button>
    </form>
   </>}
  </section>}
 </div>;
}
