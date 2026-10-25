import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = source("./App.tsx");
const modal = source("./components.tsx");
const css = source("./styles.css");

describe("Pet dialogs cannot scroll the background", () => {
  it("opens Join Pet through a real modal for accounts with and without pets", () => {
    expect(app).toContain('case "join":');
    expect(app).toContain('<JoinPet session={session} onChanged={refreshNow}');
    expect(app).toContain('if (!hasPets) { setOverlay({ kind: "addPetChoice" })');
    expect(app).toContain('setOverlay({ kind: "join" })');
    expect(app).toContain('<Modal title={title} onClose={close}>');
    // The same overlay remains mounted while Join Pet polls pending requests.
    const sharing = source("./Sharing.tsx");
    expect(sharing).toContain('setInterval(read, 5000)');
    expect(sharing).toContain('requests.map(request => (');
  });

  it("opens New Pet in that same scroll-locked modal", () => {
    expect(app).toContain('case "newpet":');
    expect(app).toContain('className="new-pet-form"');
    expect(app).toContain('setOverlay({ kind: "newpet" })');
  });

  it("pins the body at its prior offset instead of relying on overflow hidden alone", () => {
    expect(modal).toContain("const scrollY = window.scrollY;");
    expect(modal).toContain('body.style.position = "fixed";');
    expect(modal).toContain('body.style.top = `-${scrollY}px`;');
    expect(modal).toContain('body.style.width = "100%";');
    expect(modal).toContain('document.body.style.overflow = "hidden";');
    expect(modal).toContain('document.documentElement.style.overflow = "hidden";');
    expect(modal).toContain('root.style.overscrollBehavior = "none";');
    expect(modal).toContain("dialog?.showModal();");
  });

  it("restores every changed inline style and scroll position when dialog closes", () => {
    for (const field of [
      "bodyOverflow", "bodyOverscroll", "bodyPosition", "bodyTop",
      "bodyLeft", "bodyRight", "bodyWidth", "rootOverflow", "rootOverscroll",
    ]) {
      expect(modal).toContain(field + ":");
      expect(modal).toContain("original." + field);
    }
    expect(modal).toContain("dialog?.close();");
    expect(modal).toContain("window.scrollTo(0, scrollY);");
    expect(modal).toContain("previous?.focus({ preventScroll: true })");
  });

  it("still allows vertical scrolling inside the modal on iOS", () => {
    const dialog = css.split("dialog {").slice(-1)[0]?.split("}")[0] ?? "";
    expect(dialog).toContain("overflow-y: auto;");
    expect(dialog).toContain("touch-action: pan-y;");
    expect(dialog).toContain("-webkit-overflow-scrolling: touch;");
  });
});
