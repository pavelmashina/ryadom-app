import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { monthDays, shiftMonth, sessionsOnDate } from "./training-calendar";
import TrainingHistory from "./TrainingHistory";
import type { TrainingSession } from "./training-domain";
const session = (id: string, date: string): TrainingSession => ({
  id,
  date,
  created_at: date,
  updated_at: date,
  comment: "Полный комментарий " + id,
  duration_minutes: null,
  results: [
    { command_id: "cmd", performance_score: 4, mode: "repeat", comment: "" },
  ],
});
it("uses Monday-first full weeks and leap days", () => {
  const leap = monthDays("2024-02");
  expect(leap.slice(0, 3)).toEqual([null, null, null]);
  expect(leap.filter(Boolean)).toHaveLength(29);
  expect(leap).toContain("2024-02-29");
  expect(leap.length % 7).toBe(0);
  expect(monthDays("2026-03")).toHaveLength(42);
});
it("changes months across years without overflowing the selected day", () => {
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
});
it("keeps all sessions on a date and leaves empty dates empty", () => {
  const all = [
    session("a", "2026-05-01"),
    session("b", "2026-05-01"),
    session("c", "2026-05-02"),
  ];
  expect(sessionsOnDate(all, "2026-05-01").map((s) => s.id)).toEqual([
    "a",
    "b",
  ]);
  expect(sessionsOnDate(all, "2026-05-03")).toEqual([]);
});
it("initially displays the latest actual day, all its sessions and only actual dots", () => {
  const html = renderToStaticMarkup(
    <TrainingHistory
      sessions={[
        session("a", "2025-01-03"),
        session("b", "2025-01-07"),
        session("c", "2025-01-07"),
      ]}
      commands={[{ id: "cmd", name: "Рядом" }]}
      onOpen={() => {}}
      onEdit={() => {}}
    />,
  );
  expect(html).toContain("январь 2025");
  expect(html).toContain("Полный комментарий b");
  expect(html).toContain("Полный комментарий c");
  expect(html).not.toContain("Полный комментарий a");
  expect(html.match(/class="training-day-dot"/g)).toHaveLength(2);
  expect(html).toContain("7 января 2025");
  expect(html).toContain("Все занятия списком");
  expect(html.match(/>Редактировать</g)).toHaveLength(2);
});
it("shows an honest empty history", () => {
  const html = renderToStaticMarkup(
    <TrainingHistory
      sessions={[]}
      commands={[]}
      onOpen={() => {}}
      onEdit={() => {}}
    />,
  );
  expect(html).toContain("В этот день тренировок нет");
  expect(html).not.toContain('class="training-day-dot"');
});
