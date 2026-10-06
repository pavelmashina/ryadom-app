import { describe,it,expect } from "vitest";
import { commandProgress,trainingSchema,validateCommandName,type TrainingSession } from "./training-domain";
import { blankPet,stateSchema } from "./domain";
function session(score:number,index=1):TrainingSession {
 return {id:crypto.randomUUID(),date:"2026-10-"+String(index).padStart(2,"0"),duration_minutes:null,comment:"",created_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z",results:[{command_id:"sit",performance_score:score,comment:"",mode:"repeat"}]};
}
describe("Command progress",()=>{
 it("is new without history",()=>expect(commandProgress([],"sit")).toMatchObject({status:"Новая",average:null,count:0,preliminary:false}));
 it.each([[1,"Изучаем"],[2,"Изучаем"],[3,"Нестабильно"],[4,"Уверенно"],[5,"Усвоено"]])("score %s yields %s",(n,status)=>expect(commandProgress([session(n as number)],"sit")).toMatchObject({status,preliminary:true}));
 it.each([[2,3,"Нестабильно"],[3,4,"Уверенно"],[4,5,"Усвоено"]])("exact threshold %s / %s",(a,b,status)=>expect(commandProgress([session(a as number),session(b as number)],"sit").status).toBe(status));
 it("uses five latest dated sessions, not insertion order",()=>{
  const list=[session(1,1),...Array.from({length:5},(_,i)=>session(5,i+2))];
  expect(commandProgress(list.reverse(),"sit")).toMatchObject({average:5,count:6,preliminary:false,lastDate:"2026-10-06"});
 });
 it("ignores sessions for another command",()=>expect(commandProgress([session(5)],"down").count).toBe(0));
 it("recalculates after editing date and score",()=>{
  const list=Array.from({length:6},(_,i)=>session(5,i+1));list[0].results[0].performance_score=1;
  expect(commandProgress(list,"sit").average).toBe(5);
  list[0].date="2026-10-07";expect(commandProgress(list,"sit").average).toBe(4.2);
 });
 it("breaks date ties by creation time",()=>{
  const list=Array.from({length:6},(_,i)=>({...session(i===5?1:5),created_at:"2026-10-01T00:00:0"+i+"Z"}));
  expect(commandProgress(list,"sit").average).toBe(4.2);
 });
});
describe("Training validation",()=>{
 it.each([0,6,1.5,NaN])("rejects invalid score %s",n=>expect(trainingSchema.safeParse(session(n)).success).toBe(false));
 it("requires date and a command",()=>{
  expect(trainingSchema.safeParse({...session(3),date:""}).success).toBe(false);
  expect(trainingSchema.safeParse({...session(3),date:"2026-02-30"}).success).toBe(false);
  expect(trainingSchema.safeParse({...session(3),results:[]}).success).toBe(false);
 });
 it("rejects duplicate commands",()=>{const s=session(3);s.results.push(s.results[0]);expect(trainingSchema.safeParse(s).success).toBe(false);});
 it("allows optional duration and separate comments",()=>expect(trainingSchema.parse({...session(3),comment:" Общий "}).comment).toBe("Общий"));
 it("trims names and blocks case duplicates",()=>{
  expect(validateCommandName(" Сидеть ",[])).toBe("Сидеть");
  expect(()=>validateCommandName(" сидеть ",[{name:"Сидеть"}])).toThrow();
  expect(()=>validateCommandName(" ",[])).toThrow();
 });
 it("requires referenced commands to belong to this pet",()=>{
  const p=blankPet("A"),q=blankPet("B");q.commands=[{id:"sit",name:"Сидеть"}];p.workouts=[session(3)];
  expect(stateSchema.safeParse({version:1,selectedPet:p.id,pets:[p,q]}).success).toBe(false);
 });
 it("supports legacy backups without losing old results",()=>{
  const p=blankPet("A");const {workouts,...legacy}=p;
  expect(stateSchema.parse({version:1,selectedPet:p.id,pets:[legacy]}).pets[0].workouts).toEqual([]);
 });
});
