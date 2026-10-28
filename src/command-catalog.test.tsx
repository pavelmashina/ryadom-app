import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Training, { TrainingForm } from "./Training";
import type { AuthSession } from "./backend";
import { blankPet } from "./domain";
import { setCommandArchived, selectableCommands } from "./command-catalog";
function fixture() {
  const p = blankPet("Тест");
  p.commands = Array.from({ length: 21 }, (_, i) => ({
    id: String(i),
    name: "Команда " + i,
    archived: i === 20,
  }));
  p.workouts = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      date: "2026-01-01",
      duration_minutes: null,
      comment: "Запись",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      results: [
        {
          command_id: "20",
          performance_score: 4,
          mode: "repeat",
          comment: "Результат",
        },
      ],
    },
  ];
  return p;
}
it("archiving retains all historical references and leaves the source object unchanged", () => {
  const p = fixture(),
    next = setCommandArchived(p, "0", true);
  expect(next.commands[0].archived).toBe(true);
  expect(p.commands[0].archived).toBe(false);
  expect(next.workouts).toBe(p.workouts);
  expect(next.sessions).toBe(p.sessions);
  expect(next.commands.map((c) => c.id)).toEqual(p.commands.map((c) => c.id));
});
it("archived commands are selectable only when already in the edited session", () => {
  const p = fixture();
  expect(selectableCommands(p.commands).some((c) => c.id === "20")).toBe(false);
  expect(
    selectableCommands(p.commands, p.workouts[0]).some((c) => c.id === "20"),
  ).toBe(true);
});
it("initial form selection keeps a hidden archived score and announces its count", () => {
  const p = fixture();
  const html = renderToStaticMarkup(
    <TrainingForm pet={p} session={p.workouts[0]} onSave={async () => {}} />,
  );
  expect(html).toContain("Выбрано: 1");
  expect(html).toContain("Результат");
  expect(html).not.toContain("Показать все");
  expect(html.match(/class="[^"]*command-choice"/g)).toHaveLength(21);
  expect(html).toContain("aria-pressed=");
});
it("read-only Training tab disables edits and hides Commands until selected", () => {
  const html = renderToStaticMarkup(
    <Training
      pet={fixture()}
      session={{ user: { id: "test" } } as AuthSession}
      canEdit={false}
      onSave={async () => {}}
      onPlan={() => {}}
    />,
  );
  expect(html).toMatch(
    /<button[^>]*aria-label="Добавить или запланировать тренировку"[^>]*disabled=""/,
  );
  expect(html).not.toContain("Добавить команду");
  expect(html).not.toContain('class="command-list"');
  expect(html).toContain('role="tab" id="training-tab-commands"');
  expect(html).toContain('aria-selected="false"');
  expect(readFileSync(new URL("./Training.tsx",import.meta.url),"utf8"))
    .toContain('activeTab === "commands" && <div');
  expect(html).not.toContain("Показать все");
});
