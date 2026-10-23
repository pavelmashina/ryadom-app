import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingHistory from "./TrainingHistory";
import { TrainingForm } from "./Training";
import { blankPet } from "./domain";
import type { TrainingSession } from "./training-domain";

const src=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const training=src("./Training.tsx");
const history=src("./TrainingHistory.tsx");
const grid=src("./CommandGrid.tsx");
const css=src("./training.css");
const modal=src("./components.tsx");
const fixture=(scores:(number|null)[]):TrainingSession=>({
 id:"train1",date:"2026-10-23",status:"completed",name:"Тренировка",time:"",
 completed_at:"2026-10-23T14:00:00Z",created_at:"2026-10-23T14:00:00Z",
 updated_at:"2026-10-23T14:00:00Z",duration_minutes:35,comment:"",
 results:scores.map((score,i)=>({command_id:"c"+i,performance_score:score,mode:"repeat",comment:""})),
});
describe("Training screen refinements",()=>{
 it("uses the same 20px date heading as Commands",()=>{
  const day=css.split(".training-screen .training-selected-date {")[1]?.split("}")[0] ?? "";
  const commands=css.split(".training-screen .command-scroll-guide h2 {")[1]?.split("}")[0] ?? "";
  expect(day).toContain("font-size: var(--font-size-lg)");
  expect(commands).toContain("font-size: var(--font-size-lg)");
 });
 it("colors every completed command by score range while keeping unrated neutral",()=>{
  const scores=[5,4,3,2,1,null];
  const html=renderToStaticMarkup(<TrainingHistory
   sessions={[fixture(scores)]}
   commands={scores.map((_,i)=>({id:"c"+i,name:"Команда "+i}))}
   onOpen={()=>{}} onEdit={()=>{}} />);
  expect((html.match(/quality-excellent/g)??[]).length).toBe(1);
  expect((html.match(/quality-developing/g)??[]).length).toBe(2);
  expect((html.match(/quality-needs-work/g)??[]).length).toBe(2);
  expect((html.match(/quality-unrated/g)??[]).length).toBe(1);
  expect(history).toContain("r.performance_score === 5");
  expect(css).toContain("background: var(--color-warning-surface)");
  expect(css).toContain("background: var(--color-danger-surface)");
 });
 it("renders non-clickable dated command comments without learning-note preface",()=>{
  expect(training).toContain('className="training-command-comment card"');
  expect(training).not.toContain("learningNotes[command.name]");
  const comments=training.split('view.kind === "comments" && progress')[1]?.split('view.kind === "edit" && canEdit')[0]??"";
  expect(comments).not.toContain("<InteractiveCard");
  expect(comments).not.toContain('setView({ kind: "session"');
  expect(comments).toContain("<strong>{fmt(x.session.date)}</strong>");
 });
 it("locks modal background and avoids restoring focus to touch-opened command cards",()=>{
  expect(training).toContain("restoreFocus={!"); 
  expect(training).toContain("dismissOnBackdrop={!");
  expect(modal).toContain("if (!restoreFocus) previous?.blur()");
  expect(modal).toContain("if (restoreFocus) previous?.focus");
  expect(modal).toContain('document.documentElement.style.overflow = "hidden"');
  expect(modal).toContain("dismissOnBackdrop &&");
 });
 it("uses a real slider only in the training editor and removes duration and hint",()=>{
  const pet=blankPet("Бублик");
  pet.commands=Array.from({length:8},(_,i)=>({id:"c"+i,name:"Команда "+i}));
  const html=renderToStaticMarkup(<TrainingForm pet={pet} onSave={async()=>{}}/>);
  expect(html).not.toContain("Длительность, минут");
  expect(html).not.toContain("Выберите команды, затем поставьте оценку");
  expect(training).toContain('<CommandGrid scrollControls="native">');
  expect(grid).not.toContain('className="command-scroll-slider"');
  expect(grid).not.toContain('type="range"');
  expect(css).not.toContain(".training-modal-content .command-scroll-slider {");
  expect(css).toContain(".training-modal-content .command-list::-webkit-scrollbar-thumb {");
  expect(css).toContain("scrollbar-color: color-mix(in srgb, var(--color-primary) 42%, transparent)");
  expect(training).toContain('duration_minutes: session?.duration_minutes ?? null');
  expect(training).toContain('className="training-result-editor-card"');
  expect(css).toContain(".training-modal-content .training-result-editor-card .score-buttons {");
 });
});
