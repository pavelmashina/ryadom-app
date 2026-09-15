import { initialState, stateSchema, type State } from "./domain";
export const STORAGE_KEY = "ryadom:v1";
export function loadState(): { state: State; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {
      state: raw ? stateSchema.parse(JSON.parse(raw)) : initialState(),
      error: "",
    };
  } catch {
    return {
      state: initialState(),
      error:
        "Не удалось прочитать сохранённые данные. Исходная копия оставлена в браузере. Экспортируйте её перед восстановлением.",
    };
  }
}
export function saveState(state: State) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSchema.parse(state)));
}
export function parseBackup(raw: string) {
  return stateSchema.parse(JSON.parse(raw));
}
export function download(
  name: string,
  content: BlobPart,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
