import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import TrainingHistory from "./TrainingHistory";
import {isCommandFeedback} from "./training-domain";
import {blankPet,today} from "./domain";
import Account from "./Account";
import type {AuthSession} from "./backend";
import type {TrainingSession} from "./training-domain";

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const create=(day:string,status:"planned"|"completed"):TrainingSession=>({
 id:"11111111-1111-4111-8111-111111111111",
 date:day,status,name:"Утренняя тренировка",time:"10:00",schedule_id:null,
 scheduled_at:day+"T07:00:00Z",completed_at:status==="completed"?day+"T07:00:00Z":null,
 duration_minutes:null,comment:"",created_at:day+"T00:00:00Z",
 updated_at:day+"T00:00:00Z",results:[],
});
describe("Command comments and today's training",()=>{
 it("omits diary-import metadata even when text follows the marker",()=>{
  for(const note of ["Восстановлено из дневника","Восстановлено из дневника: 03.09",
   "Восстановлено из дневника — запись № 7","Импортировано из дневника. Файл",
   "Перенесено из дневника (архив)","Исходная запись: питомец"]) {
   expect(isCommandFeedback(note)).toBe(false);
  }
  expect(isCommandFeedback("Сначала выполняет с подсказкой")).toBe(true);
  expect(isCommandFeedback("  Отлично выполнил  ")).toBe(true);
  expect(isCommandFeedback("  ")).toBe(false);
  const training=read("./Training.tsx");
  expect(training).toContain(".filter((x) => isCommandFeedback(x.result.comment))");
  expect(training).toContain("isCommandFeedback(x.result.comment))?.result.comment");
 });
 it("defaults training calendar to today, not newest future workout",()=>{
  const history=read("./TrainingHistory.tsx");
  expect(history).toContain("const selected = selection ?? today()");
  expect(history).not.toContain("selection ?? latest");
  const future="2099-10-28";
  const html=renderToStaticMarkup(<TrainingHistory sessions={[create(future,"planned")]}
   commands={[]} onEdit={()=>{}} onOpen={()=>{}} onStart={()=>{}}/>);
  expect(html).toContain("Сегодня");
  expect(html).not.toContain('class="training-session-summary planned');
 });
 it("adds Start only to today's planned card; preserves future card style",()=>{
  const html=renderToStaticMarkup(<TrainingHistory
    sessions={[create(today(),"planned")]} commands={[]} onEdit={()=>{}}
    onOpen={()=>{}} onStart={()=>{}}/>);
  expect(html).toContain("Начать тренировку");
  expect(html).toContain("today-planned");
  const code=read("./TrainingHistory.tsx");
  expect(code).toContain('s.status === "planned" && s.date === today() && !readOnly');
  expect(read("./Training.tsx")).toContain('onStart={(session) => setView({ kind: "edit", session })}');
  const css=read("./training.css");
  expect(css).toContain(".training-session-summary.planned.today-planned");
  expect(css).toContain("border-style: solid");
  const futureHtml=renderToStaticMarkup(<TrainingHistory
    sessions={[create("2099-10-28","planned")]} commands={[]} onEdit={()=>{}}
    onOpen={()=>{}} onStart={()=>{}}/>);
  expect(futureHtml).not.toContain("Начать тренировку");
 });
 it("resets shopping date to today on pet changes",()=>{
  const stock=read("./Stock.tsx");
  expect(stock).toContain("useState(today)");
  expect(stock).toContain("setShoppingDate(today()); setStartDate(today());");
  expect(stock).toContain("[pet.id]");
 });
});
describe("Account editors and pet-named push",()=>{
 it("uses two right-aligned pencil-only editors with accessible labels",()=>{
  const acc=read("./Account.tsx");
  expect(acc).toContain('label="Изменить email" className="account-security-edit"');
  expect(acc).toContain('label="Изменить пароль" className="account-security-edit"');
  expect((acc.match(/<Pencil aria-hidden="true"/g)||[])).toHaveLength(2);
  expect(acc).not.toContain(">Изменить email\n");
  expect(acc).not.toContain(">Изменить пароль\n");
  const styles=read("./styles.css");
  expect(styles).toContain("grid-template-columns: var(--icon-size-md) minmax(0, 1fr) var(--button-height-sm)");
  expect(styles).toContain("grid-column: 3");
  const fake={user:{id:"1",email:"test@example.org"}} as AuthSession;
  const html=renderToStaticMarkup(<Account session={fake} onUserUpdated={()=>{}} pets={[blankPet("Тест")]} />);
  expect(html).toContain('aria-label="Изменить email"');
  expect(html).toContain('aria-label="Изменить пароль"');
 });
 it("puts pet name in push title and description in push body for all categories",()=>{
  const reminders=read("../supabase/functions/pet-push-worker/index.ts");
  const stock=read("../supabase/functions/pet-stock-push-worker/index.ts");
  expect(reminders).toContain("const petName = pets?.[0]?.name?.trim()");
  expect(reminders).toContain("title: display.title");
  expect(reminders).toContain("body: display.body");
  expect(reminders).toContain("type === \"reminder\"");
  expect(stock).toContain("title:display.title,body:display.body");
  expect(stock).toContain("title:name.slice(0,120)");
  expect(stock).toContain("job.title?.trim()");
 });
});
