import { Field, Button } from "./components";
import { useEffect, useRef, useState, type FormEvent } from "react";
import App from "./App";
import Account from "./Account";
import { PawPrint } from "lucide-react";
import {
  getValidSession,
  readRecoverySession,
  signIn,
  signOut,
  signUp,
  type AuthSession,
} from "./backend";
import PasswordRecovery from "./PasswordRecovery";
import { loadAccount, saveAccount, type CloudSnapshot } from "./cloud-data";
import type { State } from "./domain";
export default function CloudGate() {
  const [phase, setPhase] = useState<
    "loading" | "auth" | "ready" | "error" | "recovery"
  >("loading");
  const [recovery, setRecovery] = useState<AuthSession | null>(null);
  const startup = useRef<Promise<AuthSession | null> | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<{
    session: AuthSession;
    snapshot: CloudSnapshot;
  } | null>(null);
  const active = useRef<AuthSession | null>(null),
    revision = useRef(0),
    generation = useRef(0),
    saving = useRef(false);
  async function activate(session: AuthSession, epoch: number) {
    const snapshot = await loadAccount(session);
    if (generation.current !== epoch) return;
    active.current = session;
    revision.current = snapshot.revision;
    setAccount({ session, snapshot });
    setPhase("ready");
  }
  useEffect(() => {
    let stopped = false;
    const epoch = ++generation.current;
    startup.current ??= readRecoverySession();
    startup.current
      .then(
        async (recovered) => {
          if (stopped) return;
          if (recovered) {
            setRecovery(recovered);
            setPhase("recovery");
            return;
          }
          const s = await getValidSession();
          if (stopped) return;
          if (s) return activate(s, epoch);
          setPhase("auth");
        },
        (error) => {
          if (!stopped) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Не удалось проверить ссылку",
            );
            setPhase("recovery");
          }
        },
      )
      .catch((e) => {
        if (!stopped) {
          setMessage(
            e instanceof Error ? e.message : "Не удалось загрузить данные",
          );
          setPhase("error");
        }
      });
    function changed(e: StorageEvent) {
      if (e.key === "ryadom:auth:v1") {
        ++generation.current;
        active.current = null;
        setAccount(null);
        setPhase("loading");
        location.reload();
      }
    }
    window.addEventListener("storage", changed);
    function recoveryLink() {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.get("type") === "recovery" || params.has("error"))
        location.reload();
    }
    window.addEventListener("hashchange", recoveryLink);
    return () => {
      stopped = true;
      ++generation.current;
      window.removeEventListener("storage", changed);
      window.removeEventListener("hashchange", recoveryLink);
    };
  }, []);
  async function persist(next: State) {
    const s = active.current;
    if (!s) throw new Error("Войдите в аккаунт");
    if (saving.current) throw new Error("Дождитесь завершения сохранения");
    saving.current = true;
    setBusy(true);
    const epoch = generation.current;
    try {
      const saved = await saveAccount(s, next, revision.current);
      if (epoch !== generation.current)
        throw new Error("Аккаунт изменился. Войдите снова.");
      revision.current = saved.revision;
      return saved.state;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (saving.current) return;
    setBusy(true);
    ++generation.current;
    const s = active.current;
    active.current = null;
    setAccount(null);
    setPhase("auth");
    setMessage("");
    try {
      await signOut(s);
    } catch {
      setMessage("Вы вышли на этом устройстве. Сервер недоступен.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget),
      email = String(data.get("email") ?? "").trim(),
      password = String(data.get("password") ?? "");
    setBusy(true);
    setMessage("");
    try {
      const result =
        mode === "register"
          ? await signUp(email, password)
          : { session: await signIn(email, password) };
      if (!result.session) {
        setMode("login");
        setMessage("Подтвердите email по ссылке в письме, затем войдите.");
        return;
      }
      setPhase("loading");
      await activate(result.session, ++generation.current);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось войти");
      setPhase("auth");
    } finally {
      setBusy(false);
    }
  }
  if (phase === "loading")
    return (
      <div className="cloud-screen">
        <div className="cloud-card" role="status">
          Загружаем ваши данные…
        </div>
      </div>
    );
  if (phase === "recovery")
    return (
      <PasswordRecovery
        session={recovery}
        initialMessage={message}
        onBack={(notice = "") => {
          setRecovery(null);
          setMessage(notice);
          setMode("login");
          setPhase("auth");
        }}
      />
    );
  if (phase === "error")
    return (
      <div className="cloud-screen">
        <div className="cloud-card">
          <h1>Не удалось загрузить данные</h1>
          <p role="alert">{message}</p>
          <Button onClick={() => location.reload()} fullWidth variant="primary">
            Повторить
          </Button>
          <Button onClick={logout} variant="ghost">
            Выйти
          </Button>
        </div>
      </div>
    );
  if (phase === "auth")
    return (
      <div className="cloud-screen">
        <form className="cloud-card" onSubmit={submit}>
          <span className="cloud-logo">
            <PawPrint aria-hidden="true" />
          </span>
          <h1>{mode === "login" ? "Войти в Рядом" : "Создать аккаунт"}</h1>
          <p>Ваши питомцы и занятия — только в вашем аккаунте.</p>
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            disabled={busy}
          />
          <Field
            label="Пароль"
            name="password"
            type="password"
            required
            minLength={mode === "register" ? 8 : 1}
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            disabled={busy}
          />
          {message && (
            <p className="cloud-message" role="alert">
              {message}
            </p>
          )}
          <Button
            loading={busy}
            loadingText="Подождите…"
            fullWidth
            variant="primary"
            type="submit"
          >
            {busy
              ? "Подождите…"
              : mode === "login"
                ? "Войти"
                : "Зарегистрироваться"}
          </Button>
          {mode === "login" && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setRecovery(null);
                setPhase("recovery");
              }}
              variant="ghost"
            >
              Забыли пароль?
            </Button>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setMessage("");
            }}
            variant="ghost"
          >
            {mode === "login"
              ? "Нет аккаунта? Зарегистрироваться"
              : "Уже есть аккаунт? Войти"}
          </Button>
        </form>
      </div>
    );
  if (!account) return null;
  return (
    <App
      key={account.session.user.id}
      initial={account.snapshot.state}
      onPersist={persist}
      accountContent={
        <Account
          session={account.session}
          onLogout={logout}
          onUserUpdated={(user) => {
            if (active.current?.user.id === user.id) {
              active.current = { ...active.current, user };
              setAccount((previous) =>
                previous
                  ? { ...previous, session: { ...previous.session, user } }
                  : previous,
              );
            }
          }}
        />
      }
    />
  );
}
