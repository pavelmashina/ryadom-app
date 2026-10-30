import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet, today } from "./domain";
import { Sharing } from "./Sharing";
import Calendar from "./Calendar";
import Training from "./Training";
import Health from "./Health";
import type { AuthSession } from "./backend";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("./App.tsx");
const sharing = read("./Sharing.tsx");
const css = read("./styles.css");
const session: AuthSession = {
  user: { id: "tester", email: "tester@example.test" },
  accessToken: "access", refreshToken: "refresh", expiresAt: 9999999999999,
};

describe("Empty pet account navigation and access empties", () => {
  it("shows a disabled Training default and keeps the command empty state inside its own tab", () => {
    const html = renderToStaticMarkup(<Training
      session={session} pet={blankPet("Собака")}
      noPet canEdit={false} onSave={async () => {}} />);
    expect(html).toContain('role="tab" id="training-tab-commands" aria-selected="false"');
    expect(html).toContain(">Календарь</h2>");
    expect(html).not.toContain("Начните с первой команды");
    expect(read("./Training.tsx")).toContain("Чтобы добавлять команды, сначала выберите питомца.");
    expect(html).toMatch(/aria-label="Добавить или запланировать тренировку"[^>]*disabled/);
    expect(read("./CommandGrid.tsx")).toContain("{empty ?? <div");
  });

  it("uses identical, unboxed status text for no requests and no members", () => {
    const pet = blankPet("Маша");
    pet.role = "owner";
    const html = renderToStaticMarkup(<Sharing
      pet={pet} session={session}
      onChanged={async () => {}} />);
    expect(html).toContain("Новых запросов нет.");
    expect(html).toContain("Других пользователей с доступом пока нет.");
    const notices = html.match(/class="sharing-empty-message"/g) || [];
    expect(notices).toHaveLength(2);
    expect(html).not.toContain('class="card sharing-members-list"');
    expect(sharing).toContain("editorMembers.length === 0 ? (");
    expect(css).toContain(".pet-sharing-modal .sharing-empty-message");
  });

  it("preserves a fully navigable calendar without letting the visitor create events", () => {
    const day = today();
    const html = renderToStaticMarkup(<Calendar
      pet={blankPet("Питомец")} selected={day}
      month={day.slice(0, 7) + "-01"}
      readOnly setSelected={() => {}} setMonth={() => {}}
      onAdd={() => { throw new Error("Must never add"); }}
      onTraining={() => {}} onToggle={() => {}} onDetail={() => {}} />);
    expect(html).toContain('aria-label="Календарь месяца"');
    expect(html).toContain("Выберите питомца, чтобы добавлять события.");
    expect(html).toMatch(/disabled[^>]*>[^<]*<svg[^>]*>.*?Добавить событие/s);
  });

  it("makes all health creation actions disabled without a selected pet", () => {
    const html = renderToStaticMarkup(<Health pet={blankPet("Питомец")} readOnly
      onWeight={() => {}} onRecord={() => {}} onEditWeight={() => {}}
      onEditRecord={() => {}} onSummary={() => {}} onPlan={() => {}} />);
    expect(html).toContain("Здоровье");
    // The weight action uses an icon-only button: its accessible name is
    // in aria-label, which may appear before the disabled attribute.
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([markup]) => markup);
    for (const label of ["Записать вес", "Добавить запись", "Запланировать визит или прививку", "Сводка для ветеринара"]) {
      const button = buttons.find((markup) => markup.includes(label));
      expect(button, `Missing action: ${label}`).toBeDefined();
      expect(button!.slice(0, button!.indexOf(">"))).toContain("disabled");
    }
  });

  it("keeps bottom tabs for zero pets and has a completely local stock view", () => {
    expect(app).toContain('!showFirstPetSetup && screen !== "profile" && <nav className="bottom-nav"');
    expect(app).not.toContain('hasPets && !showFirstPetSetup && screen !== "profile"');
    expect(app).toContain('useState(() => blankPet("Питомец"))');
    expect(app).toContain('readOnly={!hasPets}');
    expect(app).toContain('noPet={!hasPets}');
    expect(app).toContain('screen === "stock" && (\n            <div className="stock-screen stock-no-pet">');
    expect(app).toContain('className="stock-add-trigger" disabled');
    expect(app).toContain('readOnly={!hasPets}');
  });
});
