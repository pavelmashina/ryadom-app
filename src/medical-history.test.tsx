import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("shows chart data even with a single measurement", () => {
    const html = renderToStaticMarkup(<WeightChart
      measurements={[{ id: "w1", date: "2026-10-28", value: 9.3 }]} compact />);
    expect(html).toContain("График веса");
    expect(html).toContain("9.3");
    expect(html).toContain("<circle");
  });
});
