import { useRef, useState, type FormEvent } from "react";
import { clearRecovery, requestPasswordReset, resetPassword, type AuthSession } from "./backend";

export default function PasswordRecovery({ session: initialSession, initialMessage, onBack }: {
  session: AuthSession | null; initialMessage: string; onBack: (message?: string) => void;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const lock = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (lock.current) return;
    const data = new FormData(e.currentTarget);
    lock.current = true; setBusy(true); setMessage("");
    try {
      if (session) {
        await resetPassword(session, String(data.get("password") || ""), String(data.get("confirmation") || ""));
        onBack("Пароль изменён. Войдите с новым паролем.");
      } else {
        await requestPasswordReset(String(data.get("email") || ""));
        setSent(true);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось выполнить запрос. Повторите попытку."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="cloud-screen"><form className="cloud-card" onSubmit={submit}>
    <span className="cloud-logo">🐾</span><h1>{session ? "Новый пароль" : "Восстановить пароль"}</h1>
    {session ? <><p>Придумайте новый пароль для {session.user.email || "вашего аккаунта"}.</p>
      <label>Новый пароль<input name="password" type="password" required minLength={8} autoComplete="new-password" disabled={busy}/></label>
      <label>Повторите пароль<input name="confirmation" type="password" required minLength={8} autoComplete="new-password" disabled={busy}/></label>
      <p>Минимум 8 символов.</p></> : sent ? <p role="status">Если аккаунт с этим email существует, на него придёт ссылка для восстановления. Проверьте также папку «Спам». Письмо может идти несколько минут.</p> : <><p>Укажите email, с которым зарегистрировались. Мы отправим ссылку для нового пароля.</p>
      <label>Email<input name="email" type="email" required autoComplete="email" disabled={busy}/></label></>}
    {message && <p className="cloud-message" role="alert">{message}</p>}
    {!sent && <button className="primary" disabled={busy}>{busy ? "Подождите…" : session ? "Сохранить пароль" : "Отправить ссылку"}</button>}
    {session && <button type="button" className="text-button" disabled={busy} onClick={()=>{clearRecovery();setSession(null);setMessage("");}}>Запросить новую ссылку</button>}
    <button type="button" className="text-button" disabled={busy} onClick={()=>{clearRecovery();onBack();}}>Вернуться ко входу</button>
  </form></div>;
}
