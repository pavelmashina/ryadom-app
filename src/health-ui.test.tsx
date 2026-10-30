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
    expect(html).toContain("История измерений (1)");
    expect(html).toContain("Редактировать вес от");
    expect(html).toContain("Редактировать запись: Прививка");
    expect(html).toContain("Без осложнений");
    expect(html).toContain("Связать с событием");
    expect(html).not.toContain("Без заметки");
    const readonlyHtml = renderToStaticMarkup(<Health {...props(pet, true)} />);
    expect((readonlyHtml.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(5);
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
    for (const size of ["xl", "lg", "md", "sm", "xs"]) {
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
