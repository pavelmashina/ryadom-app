import { download } from "./storage";
import { fmt, today, type Pet } from "./domain";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

/** Portable one-file medical dossier with embedded attachment data links. */
export function medicalHistoryHtml(pet: Pet): string {
  const records = [...pet.records].sort((a, b) => b.date.localeCompare(a.date));
  const weights = [...pet.weights].sort((a, b) => b.date.localeCompare(a.date));
  const weightRows = weights.map(w => `<tr><td>${escapeHtml(fmt(w.date))}</td><td>${w.value.toLocaleString("ru-RU")} кг</td></tr>`).join("");
  const recordRows = records.map(record => {
    const docs = pet.documents.filter(doc => doc.linkedRecord === record.id);
    const links = docs.map(doc =>
      `<li><a href="${doc.data}" download="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</a></li>`).join("");
    return `<article><h3>${escapeHtml(record.name)}</h3>
      <p class="metadata">${escapeHtml(record.type)} · ${escapeHtml(fmt(record.date))}</p>
      ${record.note.trim() ? `<p>${escapeHtml(record.note).replace(/\n/g,"<br>")}</p>` : ""}
      ${docs.length ? `<h4>Вложения</h4><ul>${links}</ul>` : ""}
    </article>`;
  }).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Медицинская история — ${escapeHtml(pet.name)}</title>
  <style>
  body{font:16px/1.5 Arial,sans-serif;max-width:700px;margin:24px auto;padding:0 18px;color:#293f32}
  h1{font-size:24px}h2{font-size:20px;margin-top:28px}h3{font-size:17px;margin:0 0 5px}
  h4{font-size:14px;margin-bottom:3px}p{white-space:normal;overflow-wrap:anywhere}
  .metadata{color:#576653;font-size:14px;margin:0 0 8px}
  article{padding:14px 0;border-bottom:1px solid #d6ddcf}
  table{width:100%;border-collapse:collapse}td{padding:8px 3px;border-bottom:1px solid #d6ddcf}
  a{color:#345941;overflow-wrap:anywhere}ul{padding-left:20px}
  @media print{body{margin:0}}
  </style></head><body>
  <h1>Медицинская история: ${escapeHtml(pet.name)}</h1>
  <p class="metadata">Сформировано: ${escapeHtml(fmt(today(),{day:"numeric",month:"long",year:"numeric"}))}</p>
  <h2>Медицинские записи</h2>
  ${recordRows || "<p>Записей пока нет.</p>"}
  <h2>История веса</h2>
  ${weightRows ? `<table><tbody>${weightRows}</tbody></table>` : "<p>Измерений пока нет.</p>"}
  </body></html>`;
}
export function downloadMedicalHistory(pet: Pet): void {
  download(`medical-history-${pet.id.slice(0,8)}-${today()}.html`,
    medicalHistoryHtml(pet), "text/html;charset=utf-8");
}
