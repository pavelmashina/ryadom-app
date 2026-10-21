import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingHistory from "./TrainingHistory";
import Training from "./Training";
import { blankPet } from "./domain";
import type { TrainingSession } from "./training-domain";
import type { AuthSession } from "./backend";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("./training.css");
const tokens = source("./tokens.css");
const history = source("./TrainingHistory.tsx");
const session = (id: string, time: string, name = "Тренировка"): TrainingSession => ({
  id, date: "2026-10-15", status: "completed", name, time,
  completed_at: "2026-10-15T17:00:00Z",
  created_at: "2026-10-15T17:00:00Z", updated_at: "2026-10-15T17:00:00Z",
  comment: "", duration_minutes: 35, results: [
    { command_id: "c1", performance_score: 4, mode: "repeat", comment: "" },
    { command_id: "c2", performance_score: 3, mode: "repeat", comment: "" },
  ],
});
const commands = [{ id: "c1", name: "Рядом" }, { id: "c2", name: "Ко мне" }];

describe("Training mobile composition (requirements 140–161)", () => {
  it("uses a single selected-day heading, never repeats the date inside cards", () => {
    const html = renderToStaticMarkup(<TrainingHistory
      sessions={[session("s1", "10:00"), session("s2", "19:00")]}
      commands={commands} onOpen={() => {}} onEdit={() => {}} />);
    expect(html).toContain("<h2>Календарь</h2>");
    const heading = html.match(/<h3 class="training-selected-date"[^>]*>([^<]+)<\/h3>/);
    expect(heading?.[1]).toBe("15 октября 2026");
    expect(html.match(/class="training-session-summary completed"/g)).toHaveLength(2);
    expect(html).not.toContain('class="training-session-date"');
    expect(html.match(/<strong>Тренировка<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("10:00");
    expect(html).toContain("19:00");
    expect(html).toContain("35 мин");
    expect(html).toContain("Рядом");
    expect(html).toContain("4/5");
  });

  it("removes the internal training count from the calendar heading at source", () => {
    expect(history).toContain('<SectionHeader title={list ? "История тренировок" : "Календарь"} />');
    const headingSource = history.slice(history.indexOf("<SectionHeader"), history.indexOf("{!list && ("));
    expect(headingSource).not.toContain("sessions.filter");
    expect(headingSource).not.toContain("<span>");
    expect(headingSource).not.toContain(".length");
  });

  it("uses four font-size and three weight tokens without isolated pixel overrides", () => {
    for (const name of ["xl", "lg", "md", "sm"])
      expect(tokens).toMatch(new RegExp("--font-size-" + name + ":\\s*\\d+px"));
    for (const weight of ["regular", "medium", "semibold"])
      expect(tokens).toContain("--font-weight-" + weight + ":");
    for (const lh of ["heading", "body", "caption"])
      expect(tokens).toContain("--line-height-ui-" + lh + ":");
    const fontSizes = [...css.matchAll(/font-size:\\s*([^;]+);/g)].map((x) => x[1].trim());
    expect(new Set(fontSizes)).toEqual(new Set([
      "var(--font-size-md)", "var(--font-size-lg)",
      "var(--font-size-xl)", "var(--font-size-sm)",
    ]));
    const fontWeights = [...css.matchAll(/font-weight:\\s*([^;]+);/g)].map((x) => x[1].trim());
    expect(new Set(fontWeights)).toEqual(new Set([
      "var(--font-weight-regular)", "var(--font-weight-medium)", "var(--font-weight-semibold)",
    ]));
    expect(css).not.toMatch(/(?:font-size|font-weight):\\s*(?:15px|17px|18px|19px|21px|26px|700)\\s*;/);
  });

  it("keeps a 44px hit target with smaller visual circle and calendar typography", () => {
    expect(css).toMatch(/\.training-screen \.training-day,\s*\.training-screen \.training-days > span\s*\{[^}]*min-height: var\(--button-height-sm\);/);
    expect(tokens).toContain("--button-height-sm: 44px;");
    expect(css).toMatch(/\.training-screen \.training-day::before\s*\{[^}]*width: 32px;[^}]*height: 32px;/);
    expect(css).toMatch(/\.training-screen \.training-day\s*\{[^}]*font-size: var\(--font-size-sm\);/);
    expect(css).toContain(".training-screen .training-day[aria-pressed=\"true\"]::before");
  });

  it("uses the same spacing tokens throughout calendar, header, cards and command area", () => {
    for (const name of ["--space-1", "--space-2", "--space-3", "--space-4", "--space-6"])
      expect(css).toContain("var(" + name + ")");
    for (const selector of [
      ".training-screen .heading",
      ".training-screen .command-scroller",
      ".training-screen .training-calendar",
      ".training-screen .training-selected-date",
      ".training-screen .training-session-summary.card",
      ".training-screen .training-session-actions",
    ]) expect(css).toContain(selector);
    expect(css).toContain("overflow-x: auto;");
    expect(css).toContain("grid-template-rows: repeat(2, 32px)");
    expect(css).not.toMatch(/(?:margin|padding|gap):[^;]*(?:11|17|19|27)px/);
  });

  it("renders a consistent full training screen with command and calendar sections", () => {
    const pet = blankPet("Бублик");
    pet.commands = commands;
    pet.workouts = [session("s1", "19:00")];
    const auth: AuthSession = {
      user: { id: "u", email: "tester@example.com" },
      accessToken: "test", refreshToken: "test", expiresAt: Date.now() + 3600000,
    };
    const html = renderToStaticMarkup(<Training
      pet={pet} session={auth} onSave={async () => {}} canEdit />);
    expect(html).toContain("<h1>Занятия</h1>");
    expect(html).toContain("<h2>Команды</h2>");
    expect(html).toContain("<h2>Календарь</h2>");
    expect(html).toContain('class="command-list"');
    expect(html).toContain('class="training-calendar"');
    expect(html).toContain('class="training-selected-date"');
    expect(html).toContain('class="training-session-summary completed"');
  });

  it("retains keyboard and accessible labels for day navigation", () => {
    const html = renderToStaticMarkup(<TrainingHistory
      sessions={[session("s1", "19:00")]}
      commands={commands} onOpen={() => {}} onEdit={() => {}} />);
    expect(html).toContain('aria-label="Выберите день"');
    expect(html).toContain('aria-label="Предыдущий месяц"');
    expect(html).toContain('aria-label="Следующий месяц"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Обозначения календаря"');
    expect(css).toContain(".training-screen .training-day:focus-visible");
  });
});
