import { z } from "zod";
export const SCORE_LABELS = ["Не выполняет", "Начинает понимать", "Выполняет нестабильно", "Выполняет уверенно", "Хорошо усвоено"] as const;
export const trainingSchema = z.object({
  id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
    const d = new Date(s+"T12:00:00Z"); return !isNaN(d.valueOf()) && d.toISOString().slice(0,10) === s;
  }, "Укажите корректную дату"),
  duration_minutes: z.number().int().min(1).max(600).nullable(),
  comment: z.string().trim().max(5000),
  created_at: z.string(), updated_at: z.string(),
  results: z.array(z.object({
    command_id: z.string(), performance_score: z.number().int().min(1).max(5),
    mode: z.enum(["new", "learning", "repeat"]),
    comment: z.string().trim().max(5000),
  })).min(1, "Выберите хотя бы одну команду"),
}).refine(s => new Set(s.results.map(r=>r.command_id)).size === s.results.length, "Команда выбрана дважды");
export type TrainingSession = z.infer<typeof trainingSchema>;
export function commandProgress(sessions: TrainingSession[], commandId: string) {
  const history = sessions.filter(s=>s.results.some(r=>r.command_id===commandId))
    .map(s=>({session:s, result:s.results.find(r=>r.command_id===commandId)!}))
    .sort((a,b)=>b.session.date.localeCompare(a.session.date)||b.session.created_at.localeCompare(a.session.created_at)||b.session.id.localeCompare(a.session.id));
  const recent=history.slice(0,5);
  const average=recent.length ? recent.reduce((v,x)=>v+x.result.performance_score,0)/recent.length : null;
  return {history, average, count:history.length, lastDate:history[0]?.session.date,
    preliminary:recent.length>0 && recent.length<3,
    status:average===null?"Новая":average<2.5?"Изучаем":average<3.5?"Нестабильно":average<4.5?"Уверенно":"Усвоено"};
}
export function validateCommandName(name: string, existing: {name:string}[]) {
  const trimmed=name.trim();
  if(!trimmed || trimmed.length>120) throw new Error("Название должно содержать от 1 до 120 символов");
  if(existing.some(c=>c.name.trim().toLowerCase()===trimmed.toLowerCase())) throw new Error("Такая команда уже есть");
  return trimmed;
}

