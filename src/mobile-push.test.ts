import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseVapidPublicKey } from "./vapid";
import { preventMobilePageZoom } from "./mobile-viewport";

const validKey = "BNmOrcqwLinV3xGod8ZF03SrLD42Xq6CNu2Imxo99u3M2JfxfY94LtzalIZY14B26v6XFprOBf_mEpObTDFNp4Q";

describe("PWA no-zoom viewport", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  it("contains one consistent viewport meta tag", () => {
    expect(html.match(/name="viewport"/g)).toHaveLength(1);
    expect(html).toContain("width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  });
  it("uses at least 16px font on all inputs, including files", () => {
    expect(styles).toMatch(/input, textarea, select\s*\{\s*font-size:\s*max\(16px, 1rem\)/);
    expect(styles).toMatch(/\.field input\[type="file"\]\s*\{\s*font-size:\s*16px/);
  });
  it("keeps page overflow contained but deliberate scrollers enabled", () => {
    expect(styles).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*?overflow-x:\s*hidden/);
    expect(styles).toMatch(/\.command-list, \.training-result-chips, \.score-history\s*\{[^}]*overflow-x:\s*auto/);
  });
  it("prevents two-finger gestures, not single-finger scroll", () => {
    const listeners = new Map<string, (e: any) => void>();
    const fake = {
      addEventListener: vi.fn((name, listener) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name) => listeners.delete(name)),
    } as unknown as Document;
    const cleanup = preventMobilePageZoom(fake);
    const preventDefault = vi.fn();
    listeners.get("touchmove")?.({ touches: [{}], preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    listeners.get("touchmove")?.({ touches: [{}, {}], preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    listeners.get("gesturestart")?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    cleanup();
    expect(listeners.size).toBe(0);
  });
});
describe("VAPID validation before PushManager.subscribe", () => {
  it("parses the public key into a single uncompressed P-256 point", () => {
    const key = parseVapidPublicKey(validKey);
    expect(key).toHaveLength(65);
    expect(key[0]).toBe(0x04);
  });
  it.each(["", " " + validKey, validKey + "\n", validKey.slice(0, 80), "x".repeat(87)])(
    "rejects invalid Base64URL key %s", (s) => {
      if (s === "x".repeat(87)) {
        expect(parseVapidPublicKey(s)[0]).not.toBe(4);
      } else {
        expect(() => parseVapidPublicKey(s)).toThrow();
      }
    },
  );
  it("sets app-relative worker and manifest paths", () => {
    const lifecycle = readFileSync(new URL("./PwaLifecycle.tsx", import.meta.url), "utf8");
    const builder = readFileSync(new URL("../scripts/build-pwa.mjs", import.meta.url), "utf8");
    expect(lifecycle).toContain('appUrl("sw.js").href');
    expect(builder).toContain("const base = new URL(manifestLink[1]");
  });
});
