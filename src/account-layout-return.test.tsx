import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const src=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const app=src("./App.tsx");
const css=src("./styles.css");
const stock=src("./stock.css");
const training=src("./training.css");

describe("Account layout and return navigation",()=>{
  it("matches Training's 16px distance BETWEEN sections and 12px below the heading",()=>{
    expect(training).toContain("--training-section-gap: var(--space-compact-5)");
    expect(training).toContain("--training-heading-gap: var(--space-compact-4)");
    const account=css.split("/* Account screen uses Training's two distinct layout gaps:")[1] ?? "";
    expect(account).toContain(".account-content {\n  row-gap: var(--space-compact-5);");
    expect(account).toContain(".account-content .account-section-shell + .account-section-shell {\n  margin-top: 0;");
    expect(account).toContain(".account-content .account-section-shell {\n  gap: var(--space-compact-4);");
    expect(css).toContain(".app main > .account-pets-section {\n  margin: var(--space-compact-5) 0 0;");
  });
  it("shows the arrow in content above the first Account heading with Stock editor styling",()=>{
    const section=app.split('{screen === "account" && <>')[1] ?? "";
    expect(section).toContain('className="account-back-row"');
    expect(section.indexOf('className="account-back-row"')).toBeLessThan(section.indexOf('{accountContent(state.pets)}'));
    expect(section).toContain('className="account-back" onClick={leaveAccount}');
    expect(section).toContain('aria-label="Назад"');
    expect(css).toContain(".account-back-row {");
    expect(css).toContain("margin: calc(-1 * var(--space-compact-6)) 0 var(--space-compact-2)");
    expect(css).toContain("width: var(--button-height-sm)");
    expect(stock).toContain(".stock-screen .stock-back");
  });
  it("hides the entire branded header and account icon only on the Account screen",()=>{
    expect(app).toContain('{screen !== "account" && screen !== "profile" && <header className="app-header">');
    expect(app).toContain('<span className="brand">');
    expect(app).toContain('<AccountTrigger');
    expect(src("./AccountTrigger.tsx")).toContain('className="account-trigger"');
    expect(css).toContain(".app main:has(> .account-back-row) {");
    expect(css).toContain("padding-top: calc(var(--space-compact-6) + env(safe-area-inset-top))");
    expect(app).toContain('className="account-back" onClick={leaveAccount}');
  });
  it("returns to the actual source screen, not automatically to Day",()=>{
    expect(app).toContain('[accountReturnScreen, setAccountReturnScreen] = useState<Screen>("day")');
    expect(app).toContain('if (screen !== "account") setAccountReturnScreen(screen)');
    expect(app).toContain('setScreen(accountReturnScreen === "account" ? "day" : accountReturnScreen)');
    expect(app).toContain('onClick={openAccount}');
    expect(app).not.toContain('screen === "account" || screen === "profile"');
  });
});
