import {
  Button,
  Card,
  Field,
  Form,
  Modal,
  SectionHeader,
  text,
} from "./components";
import { useEffect, useState, type ReactNode } from "react";
import { Mail, LockKeyhole, LogOut } from "lucide-react";
import { PushSettings } from "./PushSettings";
import NotificationPreferencesSettings from "./NotificationPreferencesSettings";
import {
  changeEmail,
  changePassword,
  getAccountUser,
  type AuthSession,
  type AuthUser,
} from "./backend";
export function AccountSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="account-section-shell">
      <SectionHeader title={title} />
      <Card className="account-section">{children}</Card>
    </section>
  );
}
export default function Account({
  session,
  onLogout,
  onUserUpdated,
}: {
  session: AuthSession;
  onLogout: () => Promise<void>;
  onUserUpdated: (user: AuthUser) => void;
}) {
  const [user, setUser] = useState(session.user),
    [view, setView] = useState<"email" | "password" | null>(null);
  const [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [emailError, setEmailError] = useState(""),
    [passwordError, setPasswordError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  useEffect(() => {
    let stopped = false;
    getAccountUser(session)
      .then((next) => {
        if (!stopped) {
          setUser(next);
          onUserUpdated(next);
        }
      })
      .catch((e) => {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Не удалось обновить аккаунт",
          );
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
    // A metadata refresh must not restart the request.
  }, [session.user.id]);
  return (
    <div className="account-content">
      {loading && <p role="status" className="hint">Обновляем информацию…</p>}
      {user.new_email && (
        <p className="notice">
          Ожидает подтверждения: {user.new_email}. Проверьте письма на старом
          и новом адресах.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <AccountSection title="Вход и безопасность">
        <div className="account-row">
          <Mail aria-hidden="true" />
          <div>
            <div className="account-email-line">
              <h3>Email</h3>
              <span className="account-email">{user.email}</span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEmailError("");
              setView("email");
            }}
          >
            Изменить email
          </Button>
        </div>
        <div className="account-row">
          <LockKeyhole aria-hidden="true" />
          <div>
            <h3>Пароль</h3>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setPasswordError("");
              setView("password");
            }}
          >
            Изменить пароль
          </Button>
        </div>
      </AccountSection>
      <AccountSection title="Уведомления">
        <PushSettings session={session} onEnabledChange={setPushEnabled} />
        <NotificationPreferencesSettings session={session} disabled={!pushEnabled} />
      </AccountSection>
      <AccountSection title="Сеанс">
        <p>
          Данные питомцев останутся в вашем аккаунте. Вы сможете вернуться к ним
          после входа.
        </p>
        <Button
          variant="ghost"
          loading={leaving}
          loadingText="Выходим…"
          onClick={async () => {
            if (leaving) return;
            setLeaving(true);
            try {
              await onLogout();
            } finally {
              setLeaving(false);
            }
          }}
        >
          <LogOut aria-hidden="true" />
          Выйти из аккаунта
        </Button>
      </AccountSection>
      {view && (
        <Modal
          title={view === "email" ? "Изменить email" : "Изменить пароль"}
          onClose={() => setView(null)}
        >
          {view === "email" ? (
            <Form
              label="Отправить подтверждение"
              onSave={async (data) => {
                const email = text(data, "email");
                setEmailError("");
                if (email.toLowerCase() === user.email?.toLowerCase()) {
                  setEmailError("Укажите новый email.");
                  return;
                }
                const next = await changeEmail({ ...session, user }, email);
                setUser(next);
                onUserUpdated(next);
                setView(null);
                setMessage(
                  next.email?.toLowerCase() === email.toLowerCase()
                    ? "Email изменён. Используйте новый адрес для входа."
                    : "Запрос принят. Подтвердите смену email по ссылкам в письмах — проверьте старый и новый адрес. До подтверждения входите с прежним email.",
                );
              }}
            >
              <p>Текущий адрес: {user.email}</p>
              <Field
                label="Новый email"
                name="email"
                type="email"
                required
                autoComplete="email"
                error={emailError}
                onChange={() => setEmailError("")}
              />
              <p className="hint">
                Для смены адреса может потребоваться подтверждение с обоих
                почтовых ящиков.
              </p>
            </Form>
          ) : (
            <Form
              label="Сохранить пароль"
              onSave={async (data) => {
                const password = String(data.get("password") || ""),
                  confirmation = String(data.get("confirmation") || "");
                setPasswordError("");
                if (password !== confirmation) {
                  setPasswordError("Пароли не совпадают.");
                  return;
                }
                const next = await changePassword(
                  session,
                  password,
                  confirmation,
                  String(data.get("current") || ""),
                );
                setUser(next);
                onUserUpdated(next);
                setView(null);
                setMessage(
                  "Пароль изменён. При следующем входе используйте новый пароль.",
                );
              }}
            >
              <Field
                label="Текущий пароль"
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
              <Field
                label="Новый пароль"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                hint="Минимум 8 символов. Лучше сочетать буквы и цифры."
              />
              <Field
                label="Повторите новый пароль"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                error={passwordError}
                onChange={() => setPasswordError("")}
              />
            </Form>
          )}
        </Modal>
      )}
    </div>
  );
}
