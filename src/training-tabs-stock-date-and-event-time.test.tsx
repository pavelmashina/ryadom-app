import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Training from "./Training";
import EventForm from "./EventForm";
import { blankPet, today } from "./domain";
import type { AuthSession } from "./backend";

const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const session={user:{id:"user",email:"test@example.test"},accessToken:"token",refreshToken:"token",expiresAt:999999999999} as AuthSession;

describe("Training and Commands are separate top-level views",()=>{
 it("opens the Training view by default and shows two accessible tabs",()=>{
  const pet=blankPet("Мася");
  pet.commands=[{id:"cmd-1",name:"Сидеть"}];
  const html=renderToStaticMarkup(<Training pet={pet} session={session} onSave={async()=>{}} canEdit />);
  expect(html).toContain('role="tablist"');
  expect(html).toContain('role="tab" id="training-tab-sessions" aria-selected="true"');
  expect(html).toContain('role="tab" id="training-tab-commands" aria-selected="false"');
  expect(html).toContain('id="training-panel-sessions"');
  expect(html).toContain('<h2>Календарь</h2>');
  expect(html).not.toContain('id="training-panel-commands"');
  expect(html).not.toContain('class="command-list"');
  expect(html).not.toContain("Сидеть");
  expect(html).toContain('aria-label="Добавить или запланировать тренировку"');
 });
 it("makes the Commands panel 3 columns without horizontal scrolling, with its own add action",()=>{
  const training=source("./Training.tsx"),css=source("./training.css");
  expect(training).toContain('activeTab === "commands" && <div');
  expect(training).toContain('role="tabpanel" id="training-panel-commands"');
  expect(training).toContain('setActiveTab("commands")');
  expect(training).toContain('activeTab === "commands" ? {kind:"addCommand"}');
  const grid=css.split(".training-screen .training-commands-panel .command-list {")[1]?.split("}")[0]??"";
  expect(grid).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  expect(grid).toContain("overflow: visible");
  expect(grid).toContain("grid-auto-flow: row");
  expect(grid).toContain("scroll-snap-type: none");
 });
 it("only renders per-command notes when present, separated by a horizontal line",()=>{
  const training=source("./Training.tsx"),css=source("./training.css");
  expect(training).not.toContain("Без комментария к команде");
  expect(training).toContain('r.comment.trim() && (');
  expect(training).toContain('className="note training-detail-command-note"');
  const note=css.split(".training-modal-content .training-detail-command-note {")[1]?.split("}")[0]??"";
  expect(note).toContain("border-top: 1px solid var(--color-border)");
  expect(note).toContain("padding-top: var(--space-compact-3)");
 });
});
describe("Stock card and event defaults",()=>{
 it("shows compact depletion date beside package icon, not as an extra caption",()=>{
  const stock=source("./Stock.tsx");
  expect(stock).toContain('<Badge><Package/>');
  expect(stock).toContain("stockForecastLabel(currentForecast,today())");
  expect(stock).not.toContain("Примерно до");
 });
 it("requires a clock time for new events/reminders, preserving existing all-day events",()=>{
  const form=source("./EventForm.tsx");
  expect(form).toContain('useState(existing ? !existing.time : false)');
  const html=renderToStaticMarkup(<EventForm selected={today()} onSave={()=>{}}/>);
  expect(html).toContain("Весь день");
  expect(html).toContain('name="time"');
  expect(html).not.toContain('name="time" disabled=""');
 });
 it("compacts security rows with existing typography tokens",()=>{
  const css=source("./styles.css");
  const rule=css.split("/* Compact account credential rows while retaining a 36px pencil hit target. */")[1]??"";
  expect(rule).toContain("padding-top: var(--space-compact-1)");
  expect(rule).toContain("padding-bottom: var(--space-compact-1)");
 });
});
