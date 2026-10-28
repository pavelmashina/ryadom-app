import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { appleCalendarIcs, googleCalendarUrl } from "./calendar-export";
import type { CalendarExportItem } from "./calendar-export";

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const sample:CalendarExportItem={
  id:"event-1",title:"Приём у ветеринара",
  on:"2026-12-21",time:"20:00",description:"Уточнить результаты, анализы",
  petName:"Мася",
};
describe("Add selected pet calendar event to Google and Apple",()=>{
  it("creates a Google Calendar template with a local one-hour slot and pet details",()=>{
    const url=new URL(googleCalendarUrl(sample,"Europe/Moscow"));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(sample.title);
    expect(url.searchParams.get("details")).toContain("Мася");
    expect(url.searchParams.get("details")).toContain("Уточнить результаты");
    expect(url.searchParams.get("dates")).toBe("20261221T200000/20261221T210000");
    expect(url.searchParams.get("ctz")).toBe("Europe/Moscow");
  });
  it("uses exclusive all-day end date and omits timezone for date-only records",()=>{
    const item={...sample,on:"2026-12-31",time:""};
    const url=new URL(googleCalendarUrl(item));
    expect(url.searchParams.get("dates")).toBe("20261231/20270101");
    expect(url.searchParams.has("ctz")).toBe(false);
    const ics=appleCalendarIcs(item,new Date("2026-10-28T00:00:00.000Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101\r\n");
  });
  it("creates a valid importable ICS with local timestamps and escaped Unicode notes",()=>{
    const ics=appleCalendarIcs(sample,new Date("2026-10-28T12:00:00.000Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("DTSTAMP:20261028T120000Z");
    expect(ics).toContain("DTSTART:20261221T200000");
    expect(ics).toContain("DTEND:20261221T210000");
    expect(ics).toContain("SUMMARY:Приём у ветеринара");
    expect(ics).toContain("UID:event-1-2026-12-21@ryadom-app");
    expect(ics).toContain("END:VEVENT\r\nEND:VCALENDAR\r\n");
    const unfolded = ics.replace(/\\r\\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:Мася\\nУточнить результаты\\, анализы");
    for(const line of ics.split("\r\n"))expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("does not lose dates when an event finishes after midnight",()=>{
    const item={...sample,time:"23:40",on:"2026-12-31"};
    expect(new URL(googleCalendarUrl(item)).searchParams.get("dates"))
      .toBe("20261231T234000/20270101T004000");
  });
  it("shares one calendar export UI for events, reminders and Day trainings",()=>{
    const app=source("./App.tsx");
    const event=app.split('case "detail": {')[1]?.split('case "pets":')[0]??"";
    const workout=app.split('case "trainingDetail": {')[1]?.split('case "modifyTraining": {')[0]??"";
    expect(event).toContain('<CalendarExportButtons item={{');
    expect(event).toContain("on:overlay.on");
    expect(workout).toContain("<CalendarExportButtons item={{");
    expect(workout).toContain("on: workout.date");
    const buttons=source("./CalendarExportButtons.tsx");
    expect(buttons).toContain("Google Календарь");
    expect(buttons).toContain("Apple Календарь");
    expect(buttons).toContain('window.open(googleCalendarUrl(item,zone)');
    expect(buttons).toContain("downloadAppleCalendar(item)");
  });
});
describe("Standardized checkout and comfortable security density",()=>{
  it("uses the shared 20/16/14px type hierarchy and compact spacing for checkout",()=>{
    const css=source("./stock.css");
    expect(css).toContain("dialog:has(.stock-checkout-form) .modal-head h2");
    expect(css).toContain("font-size: var(--font-size-lg)");
    expect(css).toContain(".stock-checkout-form .stock-checkout-options");
    expect(css).toContain("font-size: var(--font-size-md)");
    expect(css).toContain("font-size: var(--font-size-sm)");
    expect(css).toContain(".stock-checkout-form .stock-field");
    expect(css).toContain("min-height: var(--button-height-sm)");
    const form=css.split("dialog:has(.stock-checkout-form) .stock-checkout-form {")[1]?.split("}")[0]??"";
    expect(form).toContain("padding: 0;");
    expect(form).toContain("border: 0;"); // no double card on modal
  });
  it("restores 44px height, larger than the previously over-tight 32px security rows",()=>{
    const css=source("./styles.css");
    const section=css.split("/* Security section: intermediate comfortable density")[1]?.split("/* Reusable calendar")[0]??"";
    expect(section).toContain("min-height: var(--button-height-sm)");
    expect(section).toContain("height: var(--button-height-sm)");
    expect(section).toContain("padding: var(--space-compact-3) var(--space-compact-4)");
  });
});
