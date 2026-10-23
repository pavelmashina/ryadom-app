import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AccountSection } from "./Account";

const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const css=read("./styles.css");
const training=read("./training.css");
const app=read("./App.tsx");

describe("Account section headings use exactly one standard 12px gap",()=>{
  it("uses the shared 12px heading rhythm from the Training screen",()=>{
    expect(training).toContain("--training-heading-gap: var(--space-compact-4)");
    const rule=css.split(".account-content .account-section-shell,").at(-1)?.split("}")[0]??"";
    expect(rule).toContain("gap: var(--space-compact-4)");
  });
  it("eliminates extra vertical card margins from all Account sections",()=>{
    expect(css).toContain(".card {");
    expect(css).toContain("margin: var(--space-4) 0");
    const override=css.split(".account-content .account-section-shell > .card.account-section,").at(-1)?.split("}")[0]??"";
    expect(override).toContain(".app main > .account-pets-section > .card.account-pets-management");
    expect(override).toContain("margin: 0");
    const html=renderToStaticMarkup(<AccountSection title="Уведомления"><p>Настройки</p></AccountSection>);
    expect(html).toContain('class="account-section-shell"');
    expect(html).toContain('class="card  account-section"');
  });
  it("puts the Pet access heading outside its card with the same gap",()=>{
    expect(app).toContain('<section className="account-section-shell account-pets-section">');
    expect(app).toContain('<SectionHeader title="Питомцы и доступ" />');
    expect(css).toContain(".app main > .account-pets-section > .section-title {");
    expect(css).toContain("margin: 0;");
  });
});
