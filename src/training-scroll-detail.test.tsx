import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingHistory from "./TrainingHistory";
import CommandGrid from "./CommandGrid";
import { isCommandFeedback, type TrainingSession } from "./training-domain";

const get=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const css=get("./training.css"), global=get("./styles.css"), training=get("./Training.tsx");
const occurrence:TrainingSession={
  id:"b0c64431-9c8e-44f5-ab1e-cb3c4a0ce225",
  date:"2026-10-23", status:"planned",scheduled_at:"2026-10-23T12:00:00Z",
  completed_at:null, created_at:"2026-10-10T13:00:00Z",
  updated_at:"2026-10-10T13:00:00Z",name:"Тренировка",time:"",
  duration_minutes:null, comment:"",results:[],
};

describe("Planned training card and scroll conventions",()=>{
  it("aligns the edit icon to the right of the planned workout title without an action footer",()=>{
    const html=renderToStaticMarkup(<TrainingHistory
      sessions={[occurrence]} commands={[]}
      onOpen={()=>{}} onEdit={()=>{}} />);
    expect(html).toContain('class="training-session-title-row"');
    expect(html).toContain('class="training-inline-edit"');
    expect(html).toContain('aria-label="Редактировать тренировку"');
    expect(html).toContain("lucide-pencil");
    expect(html).not.toContain('class="training-session-actions"');
    expect(html).not.toContain('>Редактировать</button>');
    expect(css).toContain(".training-screen .training-session-summary.planned.card {");
    expect(css).toContain(".training-screen .training-session-title-row {");
    expect(css).toContain("justify-content: space-between");
  });
  it("has a single native green scrollbar under every horizontal training scroller",()=>{
    const rendered=renderToStaticMarkup(<CommandGrid title="Команды">
      {[<div key="1">Одна</div>,<div key="2">Другая</div>]}
    </CommandGrid>);
    expect(rendered).toContain("Команды");
    expect(rendered).not.toContain("Предыдущие команды");
    expect(rendered).not.toContain("Следующие команды");
    expect(get("./CommandGrid.tsx")).not.toContain("ChevronLeft");
    expect(global).toContain(":where(.command-list, .training-result-chips, .score-history, .app-horizontal-scroll)");
    expect(global).toContain("scrollbar-color: color-mix(in srgb, var(--color-primary) 42%, transparent)");
    expect(get("./TrainingHistory.tsx")).toContain("training-result-chips app-horizontal-scroll");
  });
  it("keeps a visible standard-size end-of-range select and shifts calendar markers away from day outline",()=>{
    expect(css).toContain(".recurrence-options.recurrence-options-flat-end .field select {");
    expect(css).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
    expect(css).toContain("height: var(--button-height-sm)");
    const dates=css.split(".training-screen .training-day {")[1]?.split("}")[0]??"";
    expect(dates).toContain("grid-template-rows: var(--training-day-circle) 8px");
    const dots=css.split(".training-screen .training-day-markers {")[1]?.split("}")[0]??"";
    expect(dots).toContain("transform: translateY(1px)");
  });
  it("shows only meaningful per-command comments, excluding diary bookkeeping",()=>{
    expect(isCommandFeedback("Восстановлено из дневника")).toBe(false);
    expect(isCommandFeedback(" Связано с дневником. ")).toBe(false);
    expect(isCommandFeedback("Импортировано из дневника")).toBe(false);
    expect(isCommandFeedback("")).toBe(false);
    expect(isCommandFeedback("Стала быстрее реагировать на команду")).toBe(true);
    expect(training).toContain(".filter((x) => isCommandFeedback(x.result.comment))");
    expect(training).toContain("progress.history.find((x) => isCommandFeedback(x.result.comment))");
    expect(training).not.toContain('>Восстановлено из дневника<');
  });
});
