import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Health from "./Health";
import { blankPet } from "./domain";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const noop = () => {};
const props = (pet: ReturnType<typeof blankPet>, readOnly = false) => ({
  pet, readOnly,
  onWeight: noop,
  onRecord: noop,
  onEditWeight: (_id: string) => {},
  onEditRecord: (_id: string) => {},
  onSummary: noop,
  onPlan: (_name: string, _id?: string) => {},
});

describe("Health screen follows the shared PET APP design system", () => {
  it("has one compact title without the old introductory labels", () => {
    const html = renderToStaticMarkup(<Health {...props(blankPet("Мася"))} />);
    expect(html).toContain('aria-label="Здоровье"');
    expect(html).not.toContain("<h1");
    expect(html).toContain('<h2 id="health-weight-title">Вес</h2>');
    expect(html).toContain('<h2 id="health-record-title">Медицинская история</h2>');
    expect(html.indexOf('id="health-weight-title"')).toBeLessThan(html.indexOf('id="health-record-title"'));
    expect(html).not.toContain("История заботы");
    expect(html).not.toContain("Записи, назначения и самочувствие");
    expect(html).toContain("Добавить запись");
  });

  it("keeps weight and medical edit actions accessible with the shared icon button", () => {
    const pet = blankPet("Мася");
    pet.weights = [{ id: "w1", date: "2026-10-20", value: 9.5 }];
    pet.records = [{
      id: "r1", date: "2026-10-21", type: "Прививка",
      name: "Прививка", note: "Без осложнений",
    }];
    const html = renderToStaticMarkup(<Health {...props(pet)} />);
    expect(html).toContain("Открыть историю веса");
    expect(html).toContain('aria-label="Записать вес"');
    expect(html).not.toContain("Посмотреть все измерения");
    expect(html).toContain("Запланировать визит");
    expect(html).not.toContain("История измерений (1)");
    expect(html).toContain("Редактировать запись: Прививка");
    expect(html).toContain("Без осложнений");
    expect(html).toContain("Связать с событием");
    expect(html).not.toContain("Без заметки");
    const readonlyHtml = renderToStaticMarkup(<Health {...props(pet, true)} />);
    expect((readonlyHtml.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("places weight-history pencil before the add button and fills the card with the chart", () => {
    const pet = blankPet("Мася");
    pet.weights = [
      { id: "old", date: "2026-10-17", value: 8.7 },
      { id: "recent", date: "2026-10-29", value: 9.6 },
    ];
    const html = renderToStaticMarkup(<Health {...props(pet)} />);
    const weightHeader = html.split('<h2 id="health-weight-title">Вес</h2>')[1]?.split('health-weight-card')[0] ?? "";
    expect(weightHeader).toContain("health-title-leading");
    expect(weightHeader).toMatch(/aria-label="Открыть историю веса"[\\s\\S]*?<\\/div><button[^>]*aria-label="Записать вес"/);
    expect(weightHeader).toContain('aria-label="Открыть историю веса"');
    expect(weightHeader).toContain('aria-label="Записать вес"');
    expect(weightHeader.indexOf("Открыть историю веса")).toBeLessThan(weightHeader.indexOf("Записать вес"));
    const chartCard = html.split('health-weight-card')[1]?.split('health-record-title')[0] ?? "";
    expect(chartCard).toContain("health-chart");
    expect(chartCard).not.toContain("health-current-weight");
    expect(chartCard).not.toContain("<strong>9,6</strong>");
    expect(chartCard).not.toContain("<small>кг</small>");
    expect(html.match(/aria-label="Добавить запись"/g)).toHaveLength(1);
    expect(html).toContain("health-header-add health-record-add");
    const readOnlyHtml = renderToStaticMarkup(<Health {...props(pet, true)} />);
    expect(readOnlyHtml).toMatch(/aria-label="Добавить запись"[^>]*disabled/);

    const css = source("./health.css");
    expect(css).toContain(".health-screen .health-title-row .health-header-edit.icon-button");
    expect(css).toContain(".health-screen .health-title-row .health-header-add.btn");
    const leadingStyle = css.split(".health-screen .health-title-row .health-title-leading {")[1]?.split("}")[0] ?? "";
    expect(leadingStyle).toContain("gap: var(--space-compact-2)");
    expect(css).toContain(".health-screen .health-title-row .health-title-leading h2");
    expect(css).toContain("flex: none;");
    expect(css).toContain("width: var(--icon-size-lg)");
    expect(css).toContain("height: var(--icon-size-lg)");
    expect(css).toContain(".health-screen .card.health-weight-card {");
    expect(css).toContain("padding: 0;");
    expect(css).toContain("width: 100%;");
  });

  it("matches the Training add button and keeps chart only on the main Health screen", () => {
    const health = source("./Health.tsx");
    const css = source("./health.css");
    expect(health).toContain("useState(false)");
    expect(health).toContain("<WeightChart measurements={weights} compact />");
    expect(health).toContain("setWeightDetails(true)");
    const detail = health.split("if (weightDetails) {")[1]?.split("  return (\n    <section className=\"health-screen\"")[0] ?? "";
    expect(detail).toContain('className="health-screen health-weight-page"');
    expect(detail).toContain('label="Вернуться к здоровью"');
    expect(detail).toContain("Редактировать вес от");
    expect(detail).not.toContain("<WeightChart");
    expect(detail).not.toContain("<h2");
    expect(detail).not.toContain("<h3");
    expect(detail).not.toContain("health-current-weight");
    expect(css).toContain(".health-screen .health-title-row h2");
    expect(css).toContain("width: var(--icon-size-lg)");
    expect(css).toContain("height: var(--icon-size-lg)");
    expect(css).toContain("margin-top: var(--space-compact-6)");
  });

  it("attaches medical files and exports a combined history", () => {
    const html = source("./Health.tsx");
    const app = source("./App.tsx");
    expect(html).not.toContain("downloadMedicalHistory(pet)");
    expect(app).toContain("downloadMedicalHistory(pet)");
    const summary = app.split('case "summary":')[1]?.split('case "finishShopping":')[0] ?? "";
    expect(summary).toContain("Скачать медицинскую историю");
    expect(html).toContain("d.linkedRecord === r.id");
    expect(html).toContain("download={d.filename}");
    expect(app).toContain('name="attachments"');
    expect(app).toContain("d.getAll(\"attachments\")");
    expect(app).toContain("documents: [...p.documents, ...attachments]");
  });

  it("uses the shared bounded date field in both weight and medical record forms", () => {
    const app = source("./App.tsx");
    const css = source("./health.css");
    const weightForm = app.split('case "weight":')[1]?.split('case "record":')[0] ?? "";
    const recordForm = app.split('case "record":')[1]?.split('case "deleteWeight":')[0] ?? "";
    expect(weightForm).toContain('<TrainingDateField label="Дата измерения" name="date"');
    expect(recordForm).toContain('<TrainingDateField label="Дата" name="date"');
    expect(weightForm).not.toContain('<Field label="Дата измерения" name="date" type="date"');
    expect(recordForm).not.toContain('<Field label="Дата" name="date" type="date"');
    expect(css).toContain('.health-modal-content .training-date-wrap input[type="date"]');
    expect(css).toContain('overflow: hidden;');
  });

  it("uses the same typography and spacing tokens for every health dialog", () => {
    const css = source("./health.css");
    const app = source("./App.tsx");
    for (const size of ["lg", "md", "sm", "xs"]) {
      expect(css).toContain("--font-size-" + size);
    }
    expect(css).toContain("var(--space-compact-4)");
    expect(css).toContain("dialog:has(.health-modal-content) .modal-head h2");
    expect(app).toContain('"weight", "editWeight", "deleteWeight", "record", "editRecord", "deleteRecord", "summary"');
    expect(app).toContain('<div className="health-modal-content">{modalBody()}</div>');
    expect(app).toContain('className="health-summary-record"');
    expect(app).toContain('category: "health"');
    expect(app).toContain("saveWeight(p, {");
    expect(app).toContain("saveMedicalRecord(p, {");
  });
});
