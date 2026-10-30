import type { Pet } from "./domain";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const ACCEPT_MEDICAL_FILES = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 4;

function mimeFor(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime || (file.type && file.type !== mime &&
      !(mime === "image/jpeg" && file.type === "image/jpg") &&
      file.type !== "application/octet-stream")) {
    throw new Error("Допускаются PDF, DOCX, JPG, PNG, WebP и HEIC/HEIF.");
  }
  return mime;
}
export async function readMedicalAttachments(
  entries: FormDataEntryValue[], recordId: string, recordName: string,
): Promise<Pet["documents"]> {
  const files = entries.filter((item): item is File =>
    typeof item !== "string" && item.name.length > 0);
  if (!files.length) return [];
  if (files.length > MAX_FILES)
    throw new Error("Можно прикрепить не более 4 файлов за один раз.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES)
    throw new Error("Суммарный размер файлов не должен превышать 5 МБ.");

  return Promise.all(files.map(async (file) => {
    const mime = mimeFor(file);
    if (!file.size || file.size > MAX_FILE_BYTES)
      throw new Error(`Файл «${file.name}» должен быть размером до 2 МБ.`);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Не удалось прочитать «${file.name}»`));
      reader.readAsDataURL(file);
    });
    const encoded = data.slice(data.indexOf(",") + 1);
    return {
      id: crypto.randomUUID(),
      name: recordName,
      filename: file.name,
      data: `data:${mime};base64,${encoded}`,
      linkedRecord: recordId,
    };
  }));
}
