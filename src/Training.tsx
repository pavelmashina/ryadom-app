import { useState } from "react";
import { Card, Empty, Field, Form, Modal, text } from "./components";
import { fmt, id, today, type Pet } from "./domain";
import { commandProgress, SCORE_LABELS, trainingSchema, validateCommandName, type TrainingSession } from "./training-domain";
import "./training.css";

type View = {kind:"edit"; session?:TrainingSession}|{kind:"session";id:string}|{kind:"command";id:string}|{kind:"addCommand"}|null;
export default function Training({pet,onSave,onPlan}:{pet:Pet;onSave:(pet:Pet)=>Promise<void>;onPlan:(name:string)=>void}) {
  const [view,setView]=useState<View>(null);
  const sessions=[...pet.workouts].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at));
  const selected=view?.kind==="session"?sessions.find(s=>s.id===view.id):undefined;
  const command=view?.kind==="command"?pet.commands.find(c=>c.id===view.id):undefined;
  const progress=command?commandProgress(sessions,command.id):null;
  async function saveCommand(name:string) {
    const next={id:id(),name:validateCommandName(name,pet.commands)};
    await onSave({...pet,commands:[...pet.commands,next]}); setView(null);
  }
  return <>
    <div className="heading"><span className="eyebrow">Учимся вместе</span><h1>Занятия</h1><p>Небольшие шаги, заметный прогресс · {pet.name}</p></div>
    <button className="primary" onClick={()=>setView({kind:"edit"})}>Добавить тренировку</button>
    <div className="section-title"><h2>Последние тренировки</h2><span>{sessions.length}</span></div>
    {!sessions.length && <Empty title="Пока нет тренировок">Выберите команды и отметьте, как прошло занятие.</Empty>}
    {sessions.map(s=><button className="training-row card" key={s.id} onClick={()=>setView({kind:"session",id:s.id})}>
      <strong>{fmt(s.date,{day:"numeric",month:"long",year:"numeric"})}</strong>
      <span>{s.duration_minutes? s.duration_minutes+" мин · ":""}Команд: {s.results.length}</span>
      {s.comment && <p className="training-excerpt">{s.comment}</p>}
    </button>)}
    <div className="section-title"><h2>Команды</h2><button className="text-button" onClick={()=>setView({kind:"addCommand"})}>Добавить команду</button></div>
    {!pet.commands.length && <Empty title="Начните с первой команды">Команды принадлежат только этому питомцу.</Empty>}
    {pet.commands.map(c=>{const p=commandProgress(sessions,c.id);return <button className="training-row card" key={c.id} onClick={()=>setView({kind:"command",id:c.id})}>
      <strong>{c.name}</strong><span>{p.status}{p.average!==null?" · "+p.average.toFixed(1)+" / 5":""}</span>
      <progress max={5} value={p.average??0} aria-label={"Прогресс "+c.name}/>
      {p.preliminary && <small>Предварительная оценка</small>}
    </button>;})}
    {!!pet.sessions.length && <details className="explanation"><summary>Архив занятий с повторами · {pet.sessions.length}</summary><p>Старые результаты сохранены. Повторы не переводятся автоматически в оценку 1–5.</p>{pet.sessions.map(s=><p key={s.id}>{fmt(s.date)} · {pet.commands.find(c=>c.id===s.command)?.name} · {s.good}/{s.total} · {s.note}</p>)}</details>}
    <details className="explanation"><summary>Как считается прогресс</summary><p>Средняя оценка последних пяти тренировок с этой командой: ниже 2,5 — изучаем; от 2,5 — нестабильно; от 3,5 — уверенно; от 4,5 — усвоено. До трёх тренировок оценка предварительная. Это ориентир для дневника.</p></details>
    {view && <Modal title={view.kind==="edit"?(view.session?"Редактировать тренировку":"Новая тренировка"):view.kind==="addCommand"?"Новая команда":command?.name??"Тренировка"} onClose={()=>setView(null)}>
      {view.kind==="edit" && <TrainingForm pet={pet} session={view.session} onSave={async (next,commands)=>{
        await onSave({...pet,commands,workouts:[...pet.workouts.filter(s=>s.id!==next.id),next]});
        setView({kind:"session",id:next.id});
      }}/>}
      {view.kind==="addCommand" && <Form onSave={d=>saveCommand(text(d,"name"))}><Field label="Название команды" name="name" required maxLength={120}/></Form>}
      {selected && <><p>{fmt(selected.date,{day:"numeric",month:"long",year:"numeric"})} · {selected.duration_minutes?selected.duration_minutes+" мин":"Длительность не указана"}</p>
        <p className="note">{selected.comment||"Без общего комментария"}</p>
        {selected.results.map(r=><Card key={r.command_id}><h3>{pet.commands.find(c=>c.id===r.command_id)?.name}</h3><p>{r.performance_score} / 5 — {SCORE_LABELS[r.performance_score-1]}</p><small>{{new:"Изучали впервые",learning:"Продолжали изучать",repeat:"Повторяли"}[r.mode]}</small><p className="note">{r.comment||"Без комментария к команде"}</p></Card>)}
        <button className="primary" onClick={()=>setView({kind:"edit",session:selected})}>Редактировать тренировку</button></>}
      {command && progress && <><h3>{progress.status} {progress.average!==null && "· "+progress.average.toFixed(1)+" / 5"}</h3>
        {progress.preliminary && <p className="badge">Предварительная оценка</p>}
        <p>Тренировок: {progress.count} · Последняя: {progress.lastDate?fmt(progress.lastDate):"ещё не было"}</p>
        <div className="score-history" aria-label="История оценок">{[...progress.history].reverse().map(x=><div key={x.session.id}><meter min={0} max={5} value={x.result.performance_score}/><span>{fmt(x.session.date)}</span><strong>{x.result.performance_score}/5</strong></div>)}</div>
        {progress.history.map(x=><button className="training-row card" key={x.session.id} onClick={()=>setView({kind:"session",id:x.session.id})}><strong>{fmt(x.session.date)} · {x.result.performance_score}/5</strong><p className="note">{x.result.comment||"Без комментария"}</p><small>Открыть тренировку →</small></button>)}
        <button className="secondary" onClick={()=>{setView(null);onPlan("Повторить «"+command.name+"»");}}>Запланировать повторение</button>
      </>}
    </Modal>}
  </>;
}
function TrainingForm({pet,session,onSave}:{pet:Pet;session?:TrainingSession;onSave:(s:TrainingSession,commands:Pet["commands"])=>Promise<void>}) {
  const [commands,setCommands]=useState(pet.commands);
  const [results,setResults]=useState<TrainingSession["results"]>(session?.results??[]);
  const [newName,setNewName]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  function toggle(cid:string) {setResults(rs=>rs.some(r=>r.command_id===cid)?rs.filter(r=>r.command_id!==cid):[...rs,{command_id:cid,performance_score:3,mode:"repeat",comment:""}]);}
  function add() {try {const name=validateCommandName(newName,commands),cid=id();setCommands(cs=>[...cs,{id:cid,name}]);setResults(rs=>[...rs,{command_id:cid,performance_score:3,mode:"new",comment:""}]);setNewName("");setError("");}catch(e){setError(e instanceof Error?e.message:"Проверьте название");}}
  return <Form onSave={async d=>{
    if(busy)return;
    setBusy(true);
    try {
      const parsed=trainingSchema.safeParse({id:session?.id??id(),date:text(d,"date"),duration_minutes:text(d,"duration")?Number(text(d,"duration")):null,comment:text(d,"comment"),
        created_at:session?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),results});
      if(!parsed.success)throw new Error(parsed.error.issues[0].message);
      await onSave(parsed.data,commands);
    } finally {setBusy(false);}
  }}><fieldset disabled={busy} className="training-fields">
    <Field label="Дата тренировки" name="date" type="date" required defaultValue={session?.date??today()}/>
    <Field label="Длительность, минут · необязательно" name="duration" type="number" min={1} max={600} step={1} defaultValue={session?.duration_minutes??""}/>
    <label className="field">Общий комментарий<textarea name="comment" maxLength={5000} defaultValue={session?.comment??""}/></label>
    <h3>Выберите команды</h3>
    <div className="command-chips">{commands.map(c=><button type="button" aria-pressed={results.some(r=>r.command_id===c.id)} key={c.id} onClick={()=>toggle(c.id)}>{c.name}</button>)}</div>
    <div className="inline-command"><Field label="Новая команда" value={newName} maxLength={120} onChange={e=>setNewName(e.target.value)}/><button type="button" className="secondary" onClick={add}>Добавить</button></div>
    {error && <p role="alert" className="notice">{error}</p>}
    {results.map(r=><Card key={r.command_id}><h3>{commands.find(c=>c.id===r.command_id)?.name}</h3>
      <label className="field">Что делали<select value={r.mode} onChange={e=>setResults(rs=>rs.map(x=>x.command_id===r.command_id?{...x,mode:e.target.value as typeof r.mode}:x))}><option value="new">Изучали впервые</option><option value="learning">Продолжали изучать</option><option value="repeat">Повторяли</option></select></label>
      <div className="score-buttons" role="group" aria-label={"Оценка "+commands.find(c=>c.id===r.command_id)?.name}>{SCORE_LABELS.map((label,i)=><button type="button" key={label} title={label} aria-label={(i+1)+" — "+label} aria-pressed={r.performance_score===i+1} onClick={()=>setResults(rs=>rs.map(x=>x.command_id===r.command_id?{...x,performance_score:i+1}:x))}>{i+1}</button>)}</div>
      <p>{SCORE_LABELS[r.performance_score-1]}</p>
      <label className="field">Комментарий к команде<textarea maxLength={5000} value={r.comment} onChange={e=>setResults(rs=>rs.map(x=>x.command_id===r.command_id?{...x,comment:e.target.value}:x))}/></label>
    </Card>)}
  </fieldset></Form>;
}

