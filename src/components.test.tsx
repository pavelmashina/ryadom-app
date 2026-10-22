import { expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button,IconButton,Field,InteractiveCard,Toast } from "./components";
import { readFileSync } from "node:fs";
it("action buttons do not submit surrounding forms by default",()=>{
 expect(renderToStaticMarkup(<Button>Назад</Button>)).toContain('type="button"');
});
it("loading prevents another click and is announced",()=>{
 const html=renderToStaticMarkup(<Button loading>Сохранить</Button>);
 expect(html).toContain('disabled=""');expect(html).toContain('aria-busy="true"');expect(html).toContain('Сохраняем…');
});
it("icon-only actions keep an accessible name and shared hit area",()=>{
 const html=renderToStaticMarkup(<IconButton label="Закрыть">×</IconButton>);
 expect(html).toContain('aria-label="Закрыть"');expect(html).toContain('icon-button');
});
it("field errors are programmatically associated with their input",()=>{
 const html=renderToStaticMarkup(<Field id="test-email" label="Email" error="Проверьте адрес"/>);
 expect(html).toContain('for="test-email"');expect(html).toContain('aria-describedby="test-email-help"');expect(html).toContain('aria-invalid="true"');
});
it("interactive cards are real buttons",()=>{
 const html=renderToStaticMarkup(<InteractiveCard>Тренировка</InteractiveCard>);
 expect(html.startsWith('<button')).toBe(true);expect(html).toContain('type="button"');
});

it("shows connection errors as non-blocking, auto-dismissing top toasts",()=>{
 const html=renderToStaticMarkup(<Toast message="Нет связи с сервером" tone="error"/>);
 expect(html).toContain('class="app-toast app-toast-error"');
 expect(html).toContain('role="alert"');
 expect(html).toContain("Нет связи с сервером");
 expect(renderToStaticMarkup(<Toast message=""/>)).toBe("");
 const code=readFileSync(new URL("./components.tsx",import.meta.url),"utf8");
 const css=readFileSync(new URL("./styles.css",import.meta.url),"utf8");
 expect(code).toContain('window.setTimeout(() => setVisible(false), duration)');
 expect(css).toContain("top: calc(env(safe-area-inset-top)");
 expect(css).toContain("pointer-events: none;");
});
it("removes mobile tap highlights but preserves keyboard focus outlines",()=>{
 const css=readFileSync(new URL("./styles.css",import.meta.url),"utf8");
 expect(css).toContain("-webkit-tap-highlight-color: transparent;");
 expect(css).toContain(":focus:not(:focus-visible)");
 expect(css).toContain(":focus-visible");
 expect(css).toContain("outline: 3px solid var(--color-focus)");
});
