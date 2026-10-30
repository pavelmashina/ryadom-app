import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet, petSchema } from "./domain";
import WeightChart from "./WeightChart";
import { medicalHistoryHtml } from "./medical-history-export";
import { readMedicalAttachments } from "./medical-attachments";
import { deleteMedicalRecord } from "./health-actions";

describe("Medical record attachments and history", () => {
  it("keeps linked documents in the shared pet document archive", () => {
    const pet = blankPet("Мася");
    pet.records = [{ id: "record-1", name: "Анализы", type: "Анализы / УЗИ",
      note: "Результат", date: "2026-10-28" }];
    pet.documents = [{ id: "doc-1", linkedRecord: "record-1",
      name: "Анализы", filename: "results.pdf",
      data: "data:application/pdf;base64,QUJD" }];
    expect(petSchema.parse(pet).documents[0].linkedRecord).toBe("record-1");
    const html = medicalHistoryHtml(pet);
    expect(html).toContain("results.pdf");
    expect(html).toContain("data:application/pdf;base64,QUJD");
    expect(html).toContain("Анализы");
    const removed = deleteMedicalRecord(pet, "record-1");
    expect(removed.records).toHaveLength(0);
    expect(removed.documents[0].linkedRecord).toBeUndefined();
    expect(removed.documents[0].filename).toBe("results.pdf");
  });

  it("exports the full basic pet profile and latest measured weight", () => {
    const pet = blankPet("Бим");
    pet.breed = "Вельш-корги";
    pet.birthday = "2020-05-15";
    pet.sex = "Мальчик";
    pet.chip = "999000111222333";
    pet.weights = [
      { id: "older", date: "2026-10-10", value: 10.1 },
      { id: "latest", date: "2026-10-28", value: 10.4 },
    ];
    const html = medicalHistoryHtml(pet);
    expect(html).toContain("Данные питомца");
    for (const value of [
      "Кличка", "Бим", "Порода", "Вельш-корги",
      "Дата рождения", "15 мая", "Пол", "Мальчик",
      "Номер чипа", "999000111222333",
      "Последний вес", "10,4 кг",
    ]) expect(html).toContain(value);
    expect(html).toContain("История веса");
  });

  it("escapes user-supplied text in portable medical history", () => {
    const pet = blankPet("<script>alert(1)</script>");
    pet.records = [{ id: "record-2", name: "<img src=x>", type: "Визит",
      date: "2026-10-29", note: "Норма & лучше" }];
    const html = medicalHistoryHtml(pet);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("Норма &amp; лучше");
    expect(html).not.toContain("<script>");
  });

  it("supports multiple attachments but rejects unsupported files and oversize files", async () => {
    expect(await readMedicalAttachments([], "r1", "Осмотр")).toEqual([]);
    await expect(readMedicalAttachments(
      [new File(["bad"], "readme.exe", { type: "application/octet-stream" })],
      "r1", "Осмотр",
    )).rejects.toThrow(/PDF/);
    await expect(readMedicalAttachments(
      [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.pdf",
        { type: "application/pdf" })],
      "r1", "Осмотр",
    )).rejects.toThrow(/2 МБ/);
  });

  it("keeps date and weight labels equally close to graph edges", () => {
    const chartSource = readFileSync(new URL("./WeightChart.tsx", import.meta.url), "utf8");
    expect(chartSource).toContain("const EDGE_GAP = 5;");
    expect(chartSource).toContain("top: 31, bottom: 141");
    expect(chartSource).toContain("DATE_LABEL_BASELINE = SIZE.height - EDGE_GAP - 3");
    expect(chartSource).toContain("y={DATE_LABEL_BASELINE}");
    expect(chartSource).toContain('y="21">кг</text>');
    expect(chartSource).toContain("displayKg(v).length");
    expect(chartSource).toContain("x={left - 3}");
  });

  it("always labels the most recent chart point even without a tap", () => {
    const html = renderToStaticMarkup(<WeightChart
      measurements={[
        { id: "latest", date: "2026-10-29", value: 11.6 },
        { id: "older", date: "2026-10-20", value: 9.3 },
      ]} compact />);
    expect(html).toContain('class="health-chart-latest"');
    expect(html).toContain("Последнее измерение: 11,6 кг");
    expect(html).toContain(">11,6 кг</text>");
    expect(html).not.toContain('class="health-chart-note"');
  });

  it("shows chart data even with a single measurement", () => {
    const html = renderToStaticMarkup(<WeightChart
      measurements={[{ id: "w1", date: "2026-10-28", value: 9.3 }]} compact />);
    expect(html).toContain("График веса");
    expect(html).toContain('viewBox="0 0 360 167"');
    expect(html).toContain('y1="31" y2="141"');
    expect(html).toContain('y="159"');
    expect(html).toContain("9,3");
    expect(html).toContain("health-chart-axis-label");
    expect(html).toContain("28 окт.");
    expect(html).toContain("<circle");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("health-chart-axis-label");
    expect(html).toContain("health-chart-hitarea");
  });
});
