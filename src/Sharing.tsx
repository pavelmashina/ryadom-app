import { useEffect, useState } from "react";
import { Button, Card, Field, Form, SectionHeader, text } from "./components";
import {
  petAccess,
  type AccessDetails,
  type AccessResult,
  type OutgoingRequest,
} from "./sharing-api";
import type { AuthSession } from "./backend";
import type { Pet } from "./domain";

export function JoinPet({
  session,
  onChanged,
}: {
  session: AuthSession;
  onChanged: () => Promise<void>;
}) {
  const [code, setCode] = useState(""),
    [found, setFound] = useState<AccessResult | null>(null),
    [requests, setRequests] = useState<OutgoingRequest[]>([]),
    [error, setError] = useState("");
  async function refresh() {
    setRequests(await petAccess(session, "outgoing"));
  }
  useEffect(() => {
    let stopped = false;
    const read = () =>
      petAccess<OutgoingRequest[]>(session, "outgoing")
        .then((x) => {
          if (!stopped) setRequests(x);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    void read();
    const timer = setInterval(read, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session.user.id]);
  return (
    <>
      <p>
        Введите ID, который вам передал владелец. Данные питомца станут доступны
        только после его подтверждения.
      </p>
      <Form
        label="Найти питомца"
        onSave={async (d) => {
          const value = text(d, "code").toUpperCase();
          setCode(value);
          setFound(await petAccess(session, "lookup", { code: value }));
        }}
      >
        <Field
          label="ID питомца"
          name="code"
          placeholder="RYD-…"
          required
          maxLength={30}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={() => setFound(null)}
        />
      </Form>
      {found && (
        <Card>
          <h3>{found.name}</h3>
          {found.status === "active" ? (
            <p>Этот питомец уже добавлен в ваш аккаунт.</p>
          ) : found.status === "pending" ? (
            <p role="status">
              Запрос уже отправлен. Владелец должен подтвердить доступ.
            </p>
          ) : (
            <Form
              label="Отправить запрос"
              onSave={async () => {
                setFound(await petAccess(session, "request", { code }));
                await refresh();
              }}
            >
              <p>Запросить доступ к этому питомцу?</p>
            </Form>
          )}
        </Card>
      )}
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {!!requests.length && <SectionHeader title="Ваши запросы" />}
      {requests.map((r) => (
        <Card key={r.id}>
          <h3>{r.name}</h3>
          <p>
            {
              {
                pending: "Ожидает подтверждения",
                approved: "Доступ разрешён",
                rejected: "Запрос отклонён",
                cancelled: "Запрос отменён",
              }[r.status]
            }
          </p>
          {r.status === "pending" && (
            <Form
              children={null}
              label="Отменить запрос"
              onSave={async () => {
                await petAccess(session, "cancel", { subject: r.id });
                await refresh();
                setFound(null);
              }}
            />
          )}
        </Card>
      ))}
      <Button
        fullWidth
        onClick={() => onChanged().catch((e) => setError(e.message))}
      >
        Обновить список питомцев
      </Button>
    </>
  );
}

export function Sharing({
  session,
  pet,
  onChanged,
}: {
  session: AuthSession;
  pet: Pet;
  onChanged: () => Promise<void>;
}) {
  const [details, setDetails] = useState<AccessDetails>({
      members: [],
      requests: [],
    }),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<{
      action: string;
      subject?: string;
      label: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  async function refresh() {
    if (pet.role === "owner")
      setDetails(await petAccess(session, "manage", { target: pet.id }));
  }
  useEffect(() => {
    let stopped = false;
    const read = () => {
      if (pet.role !== "owner") return;
      void petAccess<AccessDetails>(session, "manage", { target: pet.id })
        .then((x) => {
          if (!stopped) setDetails(x);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pet.id, pet.role, session.user.id]);
  async function act(action: string, subject?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await petAccess(session, action, { target: pet.id, subject });
      setConfirm(null);
      await onChanged();
      if (action !== "leave" && action !== "delete") await refresh();
      setMessage("Готово");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card>
        <h3>ID питомца</h3>
        <p className="share-code">{pet.shareCode}</p>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(pet.shareCode || "");
              setMessage("ID скопирован");
            } catch {
              setError(
                "Не удалось скопировать. Выделите ID и скопируйте вручную.",
              );
            }
          }}
        >
          Скопировать ID
        </Button>
        <p>
          Отправьте этот ID человеку, которому хотите дать возможность запросить
          доступ к питомцу. Доступ подтверждает владелец.
        </p>
      </Card>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {pet.role === "owner" ? (
        <>
          <SectionHeader
            title={`Запросы на доступ · ${details.requests.length}`}
          />
          {!details.requests.length && <p>Новых запросов нет.</p>}
          {details.requests.map((r) => (
            <Card key={r.id}>
              <h3>{r.email}</h3>
              <p>Хочет получить доступ к {pet.name}</p>
              <div className="sharing-actions">
                <Button
                  disabled={busy}
                  variant="primary"
                  onClick={() => act("approve", r.id)}
                >
                  Разрешить
                </Button>
                <Button disabled={busy} onClick={() => act("reject", r.id)}>
                  Отклонить
                </Button>
              </div>
            </Card>
          ))}
          <SectionHeader title="Пользователи с доступом" />
          {details.members.map((m) => (
            <Card key={m.user_id}>
              <h3>{m.email}</h3>
              <p>{m.role === "owner" ? "Владелец" : "Совместный доступ"}</p>
              {m.role === "editor" && (
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() =>
                    setConfirm({
                      action: "revoke",
                      subject: m.user_id,
                      label: `Отозвать доступ ${m.email} к ${pet.name}? После этого пользователь больше не сможет видеть или изменять данные питомца.`,
                    })
                  }
                >
                  Отозвать доступ
                </Button>
              )}
            </Card>
          ))}
          <Button
            disabled={busy}
            fullWidth
            onClick={() =>
              setConfirm({
                action: "rotate",
                label:
                  "Сгенерировать новый ID питомца? Старый ID перестанет работать. Участники сохранят доступ.",
              })
            }
          >
            Сгенерировать новый ID
          </Button>
          <Button
            disabled={busy}
            fullWidth
            variant="destructive"
            onClick={() =>
              setConfirm({
                action: "delete",
                label: `Удалить питомца ${pet.name}? Он исчезнет у всех участников.`,
              })
            }
          >
            Удалить питомца
          </Button>
        </>
      ) : (
        <Button
          disabled={busy}
          variant="destructive"
          fullWidth
          onClick={() =>
            setConfirm({
              action: "leave",
              label: `Покинуть питомца ${pet.name}? Данные остальных участников сохранятся. Для возвращения понадобится новый запрос.`,
            })
          }
        >
          Покинуть питомца
        </Button>
      )}
      {confirm && (
        <Card className="sharing-confirm">
          <p>{confirm.label}</p>
          <div className="sharing-actions">
            <Button disabled={busy} onClick={() => setConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => act(confirm.action, confirm.subject)}
            >
              Подтвердить
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
