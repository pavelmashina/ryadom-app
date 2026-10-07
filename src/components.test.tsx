import { expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button,IconButton,Field,InteractiveCard } from "./components";
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
