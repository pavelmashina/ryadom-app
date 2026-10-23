import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import RecurrenceFields, { draftForDate } from "./RecurrenceFields";

const css=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const global=css("./styles.css");
const training=css("./training.css");
const stock=css("./stock.css");

describe("Unified form typography, insets and weekday layout",()=>{
  it("keeps all seven weekday controls in a single seven-column row",()=>{
    const html=renderToStaticMarkup(
      <RecurrenceFields
        date="2026-10-23"
        value={{...draftForDate("2026-10-23"),frequency:"weekly"}}
        onChange={()=>{}}
        flatEnd
      />,
    );
    // RecurrenceFields initially collapses its extra settings. The source
    // defines all seven checkbox labels, and the stylesheet ensures one row.
    const recurrence=css("./RecurrenceFields.tsx");
    for(const day of ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"]) {
      expect(recurrence).toContain('"'+day+'"');
    }
    expect(html).toContain('value="weekly" selected=""');
    for(const styles of [global,training]) {
      const block=styles.split(".weekdays-picker-row {").slice(-1)[0]?.split("}")[0]??"";
      expect(block).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
      expect(block).toContain("gap: calc(var(--space-compact-1) / 2)");
    }
    expect(global).toContain(".weekdays-picker-row .checkbox-hit {");
    expect(training).toContain(".training-modal-content .weekdays-picker-row .checkbox-hit {");
    expect(training).toContain("min-height: var(--button-height-sm)");
  });

  it("uses medium rather than bold typography for form section headings",()=>{
    const base=global.match(/^h3 \{([^}]*)\}/m)?.[1]??"";
    expect(base).toContain("font-weight: var(--font-weight-medium)");
    expect(training).toContain(".training-modal-content h3 {font-size:var(--font-size-md);font-weight:var(--font-weight-medium)");
    expect(training).not.toContain(".training-modal-content h3 {font-size:var(--font-size-md);font-weight:var(--font-weight-semibold)");
  });

  it("adds consistent internal left spacing without changing outer form width",()=>{
    expect(global).toContain("padding: var(--space-3) var(--space-4)");
    expect(training).toContain("padding:var(--space-compact-3) var(--space-compact-4)");
    expect(training).toContain("padding: var(--space-compact-1) var(--space-compact-3)");
    expect(stock).toContain("padding: var(--space-compact-3) var(--space-compact-4)");
    for(const styles of [training,stock]) expect(styles).toContain("min-inline-size: 0");
  });
});
