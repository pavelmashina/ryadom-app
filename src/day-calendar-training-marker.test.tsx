import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Calendar from "./Calendar";
import { blankPet } from "./domain";
import type { TrainingSession } from "./training-domain";

const DAY = "2026-10-15";
const workout = (id: string, status: TrainingSession["status"]): TrainingSession => ({
  id,
  date: DAY,
  status,
  name: "Занятие",
  time: "12:00",
  scheduled_at: "2026-10-15T09:00:00Z",
  completed_at: status === "completed" ? "2026-10-15T10:00:00Z" : null,
  duration_minutes: status === "completed" ? 30 : null,
  comment: "",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  results: [],
});
function renderDay(workouts: TrainingSession[]) {
  const pet = blankPet("Мася");
  pet.workouts = workouts;
  const html = renderToStaticMarkup(
    <Calendar
      pet={pet} selected={DAY} month="2026-10-01"
      setSelected={() => {}} setMonth={() => {}}
      onAdd={() => {}} onTraining={() => {}} onToggle={() => {}}
      onDetail={() => {}}
    />,
  );
  const day = html.match(/<button\b[^>]*aria-label="15 октября[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  return { html, day };
}

describe("Day calendar matches Training's completion marker states", () => {
  it("uses an outlined marker for a workout that is not completed", () => {
    const { day } = renderDay([workout("planned", "planned")]);
    expect(day).toContain('class="dot training training-planned"');
    expect(day).not.toContain("training-mixed");
  });

  it("uses a filled marker for a completed workout, including legacy sessions", () => {
    for (const status of ["completed", undefined] as const) {
      const { day } = renderDay([workout("completed", status)]);
      expect(day).toContain('class="dot training"');
      expect(day).not.toContain("training-planned");
      expect(day).not.toContain("training-mixed");
    }
  });

  it("keeps both states when completed and planned workouts share a day", () => {
    const { day } = renderDay([
      workout("completed", "completed"),
      workout("planned", "planned"),
    ]);
    expect(day).toContain('class="dot training training-mixed"');
  });

  it("ignores cancelled workouts and preserves existing category markers", () => {
    const { day } = renderDay([workout("cancelled", "cancelled")]);
    expect(day).not.toContain('class="dot training');
  });

  it("styles the two non-filled states to match the training calendar", () => {
    const dayCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const trainingCss = readFileSync(new URL("./training.css", import.meta.url), "utf8");
    expect(dayCss).toContain(".day-screen .calendar .date.btn .dot.training-planned");
    expect(dayCss).toContain(".day-screen .calendar .date.btn .dot.training-mixed");
    expect(dayCss).toContain("border: 1px solid var(--color-training)");
    expect(dayCss).toContain("background: transparent;");
    expect(dayCss).toContain(".dot.training-mixed::after");
    expect(trainingCss).toContain(".training-screen .training-day-planned");
    expect(trainingCss).toContain(".training-screen .training-day-markers.both");
  });
});
