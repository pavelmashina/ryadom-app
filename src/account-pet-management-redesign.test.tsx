import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (f:string)=>readFileSync(new URL(f,import.meta.url),"utf8");
const app=read("./App.tsx"),account=read("./Account.tsx"),cloud=read("./CloudGate.tsx"),css=read("./styles.css");
describe("Account pet list, add flow and profile management",()=>{
  it("shows pet rows with individual management controls and exactly one add action",()=>{
    const part=app.split('<section className="account-section-shell account-pets-section">')[1]?.split("</section>")[0]??"";
    expect(part).toContain('state.pets.map(p=>');
    expect(part).toContain('aria-label={"Управлять питомцем "+p.name}');
    expect(part).toContain('onClick={()=>goToPetSettings(p)}');
    expect(part).toContain("onClick={addPetChoice}");
    expect((part.match(/Добавить питомца/g)||[]).length).toBe(1);
    expect(part).not.toContain("Добавить существующего питомца");
    expect(part).not.toContain("Управление всеми питомцами");
  });
  it("uses the same two-option add flow in the header switcher",()=>{
    expect(app).toContain('case "addPetChoice":');
    expect(app).toContain("Создать нового питомца");
    expect(app).toContain("Добавить с помощью кода");
    const menu=app.split('className="pet-switcher-menu"')[1]?.split("</div>")[0]??"";
    expect(menu).toContain("onClick={addPetChoice}");
    expect(app).toContain('if (!hasPets) { setOverlay({ kind: "addPetChoice" })');
  });
  it("places an understated red logout after the pet management section",()=>{
    expect(account).not.toContain('title="Сеанс"');
    expect(account).not.toContain("Выйти из аккаунта");
    expect(app).toContain('className="account-logout"');
    expect(app).toContain('<LogOut aria-hidden="true"/> Выйти из аккаунта');
    expect(app.indexOf('className="account-logout"')).toBeGreaterThan(app.indexOf('className="account-pets-management"'));
    expect(app).toContain('try { await onLogout(); } finally { setLeavingAccount(false); }');
    expect(cloud).toContain('onLogout={logout}');
    expect(css).toContain('color: color-mix(in srgb, var(--color-danger) 72%, var(--color-text-secondary))');
  });
  it("renders full pet management without brand, picker, or Account icon, with back to source",()=>{
    expect(app).toContain('screen !== "account" && screen !== "profile" && <header');
    expect(app).toContain('<section className="pet-profile-screen">');
    expect(app).toContain('className="account-back" onClick={leavePetProfile}');
    expect(app).toContain('setProfileReturnScreen(screen)');
    expect(app).toContain('setScreen(profileReturnScreen === "profile" ? "account" : profileReturnScreen)');
    const profile=app.split('<section className="pet-profile-screen">')[1]?.split('</section>\n          )}')[0]??"";
    expect(profile).not.toContain("Мой питомец");
    expect(profile).not.toContain("Все питомцы");
    expect(css).toContain(".pet-profile-screen .pet-profile-section {");
    expect(css).toContain("gap:var(--space-compact-4)");
  });
});
