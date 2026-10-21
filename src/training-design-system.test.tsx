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
    expect(heading?.[1]).toBe("15 октября");
    expect(html.match(/class="card\s+training-session-summary completed"/g)).toHaveLength(2);
    expect(html).not.toContain('class="training-session-date"');
    expect(html.match(/<strong>Тренировка<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("10:00");
    expect(html).toContain("19:00");
    expect(html).toContain("35 мин");
    expect(html).toContain("Рядом");
    expect(html).toContain("4/5");
  });

  it("does not reserve a second chip row for a single result", () => {
    const lone = session("s1", "12:00");
    lone.results = lone.results.slice(0, 1);
    const html = renderToStaticMarkup(<TrainingHistory
      sessions={[lone]} commands={commands}
      onOpen={() => {}} onEdit={() => {}} />);
    expect(html).toContain('class="training-result-chips single"');
    expect(css).toContain(".training-screen .training-result-chips.single");
  });

  it("removes the internal training count from the calendar heading at source", () => {
    expect(history).toContain('<SectionHeader title={list ? "История тренировок" : "Календарь"} />');
    const headingSource = history.slice(history.indexOf("<SectionHeader"), history.indexOf("{!list && ("));
    expect(headingSource).not.toContain("sessions.filter");
    expect(headingSource).not.toContain("<span>");
    expect(headingSource).not.toContain(".length");
  });

  it("uses five font-size and three weight tokens without isolated pixel overrides", () => {
    for (const name of ["xl", "lg", "md", "sm", "xs"])
      expect(tokens).toMatch(new RegExp("--font-size-" + name + ":\\s*\\d+px"));
    for (const weight of ["regular", "medium", "semibold"])
      expect(tokens).toContain("--font-weight-" + weight + ":");
    for (const lh of ["heading", "body", "caption"])
      expect(tokens).toContain("--line-height-ui-" + lh + ":");
    const fontSizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((x) => x[1].trim());
    // XL remains in the shared design tokens, but this screen has no top-level title.
    expect(new Set(fontSizes)).toEqual(new Set([
      "var(--font-size-md)", "var(--font-size-lg)",
      "var(--font-size-sm)", "var(--font-size-xs)",
    ]));
    const fontWeights = [...css.matchAll(/font-weight:\s*([^;]+);/g)].map((x) => x[1].trim());
    expect(new Set(fontWeights)).toEqual(new Set([
      "var(--font-weight-regular)", "var(--font-weight-medium)", "var(--font-weight-semibold)",
    ]));
    expect(css).not.toMatch(/(?:font-size|font-weight):\s*(?:15px|17px|18px|19px|21px|26px|700)\s*;/);
  });

  it("uses rigid 44px day cells and truly circular 36px day numbers", () => {
    expect(css).toContain("--training-day-size: 44px;");
    expect(css).toContain("--training-day-circle: 36px;");
    expect(css).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(css).toContain("grid-auto-rows: var(--training-day-size)");
    const dayRule = css.split(".training-screen .training-day {")[1]?.split("}")[0] ?? "";
    expect(dayRule).toContain("grid-template-rows: var(--training-day-circle) 6px");
    expect(dayRule).toContain("align-content: center");
    expect(dayRule).toContain("justify-items: center");
    const numberRule = css.split(".training-screen .training-day-number {")[1]?.split("}")[0] ?? "";
    expect(numberRule).toContain("display: grid");
    expect(numberRule).toContain("place-items: center");
    expect(numberRule).toContain("width: var(--training-day-circle)");
    expect(numberRule).toContain("height: var(--training-day-circle)");
    expect(numberRule).toContain("min-width: var(--training-day-circle)");
    expect(numberRule).toContain("min-height: var(--training-day-circle)");
    expect(numberRule).toContain("aspect-ratio: 1 / 1");
    expect(numberRule).toContain("line-height: 1");
    expect(numberRule).toContain("border-radius: 50%");
    const markerRule = css.split(".training-screen .training-day-markers {")[1]?.split("}")[0] ?? "";
    expect(markerRule).toContain("align-items: center");
    expect(markerRule).toContain("justify-content: center");
    expect(markerRule).toContain("height: 6px");
    expect(css).toContain('.training-screen .training-day[aria-pressed="true"] .training-day-number');
    expect(css).toContain('.training-screen .training-day[aria-current="date"] .training-day-number');
    expect(css).not.toContain(".training-day::before");
    expect(css).not.toMatch(/margin-left:|translateX\(/);
  });

  it("uses the compact 4/6/8/12/16/20 spacing rhythm across the screen", () => {
    const scale = [4, 6, 8, 12, 16, 20];
    for (const [i, px] of scale.entries()) {
      const name = "--space-compact-" + (i + 1);
      expect(tokens).toContain(name + ": " + px + "px;");
      expect(css).toContain("var(" + name + ")");
    }
    for (const selector of [
      ".training-screen .command-scroller",
      ".training-screen .training-calendar",
      ".training-screen .training-selected-date",
      ".training-screen .training-session-summary.card",
      ".training-screen .training-session-actions",
    ]) expect(css).toContain(selector);
    const declarations = [...css.matchAll(/(?:margin|padding|gap):\s*([^;]+);/g)]
      .map((x) => x[1].trim());
    expect(declarations.some((x) => /(?:24|32|11|17|19|27)px/.test(x))).toBe(false);
    expect(css).toContain("grid-template-rows: repeat(2, 28px)");
    expect(css).toContain("overflow-x: auto;");
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
    expect(html).not.toContain("<h1>Занятия</h1>");
    expect(html).not.toContain('class="heading"');
    expect(html).toContain("<h2>Команды</h2>");
    expect(html).toContain("<h2>Календарь</h2>");
    expect(html).toContain('class="command-list"');
    expect(html).toContain('class="training-calendar"');
    expect(html).toContain('class="training-selected-date"');
    expect(html).toMatch(/class="card\s+training-session-summary completed"/);
  });

  it("uses the Calendar heading gap consistently after Commands and selected-date headings", () => {
    expect(css).toContain("--training-heading-gap: var(--space-compact-4)");
    expect(css).toContain("--training-section-gap: var(--space-compact-5)");
    const title = css.split(".training-screen .section-title {")[1]?.split("}")[0] ?? "";
    const command = css.split(".training-screen .command-scroll-guide {")[1]?.split("}")[0] ?? "";
    const selectedDay = css.split(".training-screen .training-selected-date {")[1]?.split("}")[0] ?? "";
    const commandSection = css.split(".training-screen .command-scroller {")[1]?.split("}")[0] ?? "";
    const optionalSchedule = css.split(".training-screen .explanation {")[1]?.split("}")[0] ?? "";
    expect(title).toContain("margin: 0 0 var(--training-heading-gap)");
    expect(command).toContain("margin: 0 0 var(--training-heading-gap)");
    expect(selectedDay).toContain("0 var(--training-heading-gap)");
    expect(commandSection).toContain("margin-bottom: var(--training-section-gap)");
    expect(optionalSchedule).toContain("margin-top: var(--training-section-gap)");
    expect(css).toContain(".training-screen > .explanation + .training-history");
    expect(css).toContain(".training-screen .explanation[open] > summary");
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
