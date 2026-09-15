import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { stateSchema, type State } from "./domain";
import { loadState, STORAGE_KEY } from "./storage";
import {
  getValidSession,
  loadCloudState,
  readStoredSession,
  saveCloudState,
  signIn,
  signOut,
  signUp,
  type AuthSession,
} from "./backend";

type Phase = "loading" | "auth" | "ready" | "error";
type Mode = "login" | "register";

async function activateCloud(session: AuthSession) {
  const local = loadState();
  const cloud = await loadCloudState(session);

  if (cloud) {
    const parsed = stateSchema.parse(cloud.state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  }

  if (local.error) {
    throw new Error(
      "Локальные данные повреждены. Сначала экспортируйте их через резервную копию.",
    );
  }

  await saveCloudState(session, local.state);
  return local.state;
}

export default function CloudGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<Mode>("login");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getValidSession();
        if (!current) {
          if (!cancelled) setPhase("auth");
          return;
        }
        await activateCloud(current);
        if (!cancelled) {
          setSession(current);
          setPhase("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Не удалось загрузить данные из облака");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;

    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<State>).detail;
      if (!detail) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const current = await getValidSession();
          if (!current) throw new Error("Сессия истекла");
          await saveCloudState(current, stateSchema.parse(detail));
          setSession(current);
          setMessage("Синхронизировано с облаком");
        } catch (error) {
          setMessage(
            `Локально сохранено, но облачная синхронизация не удалась: ${
              error instanceof Error ? error.message : "ошибка"
            }`,
          );
        }
      }, 350);
    };

    window.addEventListener("ryadom:state-saved", onSaved);
    return () => {
      window.removeEventListener("ryadom:state-saved", onSaved);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [phase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    if (!email || !password) return;
    if (password.length < 8) {
      setMessage("Пароль должен содержать минимум 8 символов");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      if (mode === "register") {
        const result = await signUp(email, password);
        if (result.needsEmailConfirmation || !result.session) {
          setMessage("Аккаунт создан. Подтвердите email по письму Supabase, затем войдите.");
          setMode("login");
          return;
        }
        await activateCloud(result.session);
        setSession(result.session);
        setPhase("ready");
        return;
      }

      const next = await signIn(email, password);
      await activateCloud(next);
      setSession(next);
      setPhase("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await signOut(readStoredSession());
      setSession(null);
      setMessage("");
      setPhase("auth");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="cloud-screen">
        <div className="cloud-card">
          <strong>Рядом</strong>
          <p>Загружаем ваши данные…</p>
        </div>
      </div>
    );
  }

  if (phase === "auth") {
    return (
      <div className="cloud-screen">
        <form className="cloud-card" onSubmit={submit}>
          <span className="cloud-logo">🐾</span>
          <h1>Рядом</h1>
          <p>Данные питомцев будут синхронизироваться между вашими устройствами.</p>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {message && <p className="cloud-message">{message}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setMessage("");
            }}
          >
            {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
        </form>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="cloud-screen">
        <div className="cloud-card">
          <h2>Не удалось открыть облачные данные</h2>
          <p className="cloud-message">{message}</p>
          <button className="primary" onClick={() => location.reload()}>
            Повторить
          </button>
          <button
            className="text-button"
            onClick={async () => {
              await signOut(readStoredSession());
              setSession(null);
              setMessage("");
              setPhase("auth");
            }}
          >
            Войти в другой аккаунт
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cloud-account" title={message || "Облачная синхронизация включена"}>
        <span>☁ {message || "Облако подключено"}</span>
        <button type="button" onClick={logout} disabled={busy}>
          {session?.user.email || "Выйти"}
        </button>
      </div>
      {children}
    </>
  );
}
