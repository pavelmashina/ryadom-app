import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPet, today } from "./domain";
import { trainingStatusLabel } from "./training-status";
import TrainingHistory from "./TrainingHistory";
import Calendar from "./Calendar";
import type { TrainingSession } from "./training-domain";

const shiftDay = (day: string, offset: number) => {
  const value = new Date(day + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

const workout = (date: string, status: TrainingSession["status"]): TrainingSession => ({
  id: "workout-" + date + "-" + status,
  date,
  status,
  name: "Тренировка",
  time: "18:00",
  schedule_id: null,
  scheduled_at: date + "T15:00:00Z",
  completed_at: status === "completed" ? date + "T16:00:00Z" : null,
  duration_minutes: status === "completed" ? 40 : null,
  comment: "",
  results: [],
  created_at: date + "T12:00:00Z",
  updated_at: date + "T12:00:00Z",
});

describe("Automatic missed-training status", () => {
  it("shows missed only after a planned training day has passed", () => {
    const reference = "2026-11-09";
    expect(trainingStatusLabel(workout("2026-11-08", "planned"), reference))
      .toBe("Пропущена");
    expect(trainingStatusLabel(workout("2026-11-09", "planned"), reference))
      .toBe("Запланирована");
    expect(trainingStatusLabel(workout("2026-11-10", "planned"), reference))
      .toBe("Запланирована");
  });

  it("never calls completed or cancelled training missed, including old completed records", () => {
    const reference = "2026-11-09";
    expect(trainingStatusLabel(workout("2026-10-20", "completed"), reference))
      .toBe("Проведена");
    expect(trainingStatusLabel(workout("2026-10-20", undefined), reference))
      .toBe("Проведена");
    expect(trainingStatusLabel(workout("2026-10-20", "cancelled"), reference))
      .toBe("Отменена");
  });

  it("shows missed in Training calendar while retaining the edit control", () => {
    const day = shiftDay(today(), -1);
    const html = renderToStaticMarkup(<TrainingHistory
      initialDate={day}
      sessions={[workout(day, "planned")]}
      commands={[]}
      onOpen={() => {}}
      onEdit={() => {}}
    />);
    expect(html).toContain("Пропущена");
    expect(html).toContain('aria-label="Редактировать тренировку"');
    expect(html).not.toContain(">Запланирована</span>");
  });

  it("shows missed on the main Day screen while completed stays completed", () => {
    const day = shiftDay(today(), -2);
    const pet = blankPet("Мася");
    pet.workouts = [workout(day, "planned"), workout(day, "completed")];
    const html = renderToStaticMarkup(<Calendar
      pet={pet}
      selected={day}
      month={day.slice(0, 7) + "-01"}
      setSelected={() => {}} setMonth={() => {}}
      onAdd={() => {}} onTraining={() => {}}
      onToggle={() => {}} onDetail={() => {}}
    />);
    expect(html).toContain("Пропущена");
    expect(html).toContain("Проведена");
    // Missing a training does not count as a completed session.
    expect(html).toContain("Выполнено <!-- -->1");
  });
});
