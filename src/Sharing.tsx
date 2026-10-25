import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Form, IconButton, SectionHeader, text } from "./components";
import { Copy, RefreshCw } from "lucide-react";
import {
  petAccess,
  type AccessDetails,
  type AccessResult,
  type OutgoingRequest,
  getPetMembers,
  pendingAccessRequests,
} from "./sharing-api";
import type { AuthSession } from "./backend";
import type { Pet } from "./domain";

export function JoinPet({
  session, onChanged, initialCode,
}: {
  session: AuthSession;
  onChanged: () => Promise<void>;
  initialCode?: string | null;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [found, setFound] = useState<AccessResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [requests, setRequests] = useState<OutgoingRequest[]>([]);
  const [error, setError] = useState("");
  const approvedSignature = useRef("");
  const isNotFound = (error: unknown) =>
    error instanceof Error && /Питомец с таким ID не найден/i.test(error.message);

  async function lookup(value: string) {
    setFound(null);
    setNotFound(false);
    setError("");
    try {
      setFound(await petAccess<AccessResult>(session, "lookup", { code: value }));
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else throw error;
    }
  }

  function updateRequests(next: OutgoingRequest[]) {
    setRequests(pendingAccessRequests(next));
    const approved = next.filter(r => r.status === "approved").map(r => r.id).sort().join(",");
    if (approved !== approvedSignature.current) {
      approvedSignature.current = approved;
      if (approved) void onChanged().catch(error =>
        setError(error instanceof Error ? error.message : "Не удалось обновить питомцев."));
    }
  }
  async function refreshRequests() {
    updateRequests(await petAccess<OutgoingRequest[]>(session, "outgoing"));
  }
  useEffect(() => {
    if (!initialCode) return;
    let alive = true;
    void petAccess<AccessResult>(session, "lookup", { code: initialCode })
      .then(result => {
        if (alive) { setCode(initialCode); setFound(result); setNotFound(false); }
      })
      .catch(error => {
        if (!alive) return;
        if (isNotFound(error)) { setNotFound(true); setFound(null); }
        else setError(error instanceof Error ? error.message : "Приглашение недоступно.");
      });
    return () => { alive = false; };
  }, [initialCode, session.user.id]);
  useEffect(() => {
    let stopped = false;
    const read = () => {
      void petAccess<OutgoingRequest[]>(session, "outgoing")
        .then(next => {
          if (stopped) return;
          updateRequests(next);
        })
        .catch(error => {
          if (!stopped) setError(error instanceof Error ? error.message : "Не удалось загрузить запросы.");
        });
    };
    read();
    const timer = window.setInterval(read, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [session.user.id]);

  return (
    <div className="standard-pet-modal pet-join-modal">
      <Form label="Найти питомца" onSave={async data => {
        const value = text(data, "code").toUpperCase();
        setCode(value);
        await lookup(value);
      }}>
        <Field label="ID питомца" name="code" placeholder="RYD-…"
          defaultValue={initialCode ?? ""} required maxLength={30}
          autoCapitalize="characters" autoComplete="off"
          onChange={() => { setFound(null); setNotFound(false); setError(""); }} />
      </Form>
      {notFound && (
        <p role="status" className="notice notice-error">
          Питомец с таким ID не найден. Попробуйте другой код.
        </p>
      )}
      {found && (
        <Card className="pet-join-result">
          <h3>{found.name}</h3>
          {found.status === "active" ? (
            <p>Этот питомец уже добавлен в ваш аккаунт.</p>
          ) : found.status === "pending" ? (
            <p role="status">Запрос уже отправлен. Владелец должен подтвердить доступ.</p>
          ) : (
            <Form label="Отправить запрос на добавление" onSave={async () => {
              setFound(await petAccess<AccessResult>(session, "request", { code }));
              await refreshRequests();
            }}>
              <p>Добавить питомца {found.name}?</p>
            </Form>
          )}
        </Card>
      )}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {!!requests.length && <SectionHeader title="Ваши запросы" />}
      {requests.map(request => (
        <Card key={request.id} className="pet-join-request">
          <h3>{request.name}</h3>
          <p className="pet-join-request-status">Ожидает подтверждения</p>
          <Form children={null} label="Отменить запрос" onSave={async () => {
            await petAccess(session, "cancel", { subject: request.id });
            await refreshRequests();
            setFound(null);
          }} />
        </Card>
      ))}
    </div>
  );
}

export function PetMembersSummary({
  session, pet,
}: {
  session: AuthSession;
  pet: Pet;
}) {
  const [members, setMembers] = useState<AccessDetails["members"] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setMembers(null);
    setError("");
    const read = () => {
      void getPetMembers(session, pet.id)
        .then(result => { if (!stopped) { setMembers(result); setError(""); } })
        .catch(error => {
          if (!stopped) setError(error instanceof Error ? error.message : "Не удалось загрузить участников.");
        });
    };
    read();
    const timer = window.setInterval(read, 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [pet.id, session.user.id]);
  return (
    <div className="pet-member-summary">
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {members === null && !error && <p className="hint">Загружаем пользователей…</p>}
      {members?.length === 0 && <p className="hint">Участников пока нет.</p>}
      {members?.map(member => (
        <div key={member.user_id} className="pet-member-row">
          <span>{member.email}</span>
          <span>{member.role === "owner" ? "Владелец" : "Совместный доступ"}</span>
        </div>
      ))}
    </div>
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
  const editorMembers = details.members.filter((member) => member.role === "editor");
  return (
    <>
      <Card className="sharing-id-card">
        <h3>ID питомца</h3>
        <div className="sharing-id-row">
          <p className="share-code">{pet.shareCode}</p>
          <div className="sharing-id-actions">
            <IconButton
              label="Скопировать ID"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pet.shareCode || "");
                  setMessage("ID скопирован");
                } catch {
                  setError("Не удалось скопировать. Выделите ID и скопируйте вручную.");
                }
              }}
            >
              <Copy aria-hidden="true" />
            </IconButton>
            {pet.role === "owner" && (
              <IconButton
                label="Сгенерировать новый ID"
                disabled={busy}
                onClick={() => setConfirm({
                  action: "rotate",
                  label: "Сгенерировать новый ID питомца? Старый ID перестанет работать. Участники сохранят доступ.",
                })}
              >
                <RefreshCw aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
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
          {!details.requests.length && <p className="sharing-empty-message">Новых запросов нет.</p>}
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
          {editorMembers.length === 0 ? (
            <p className="sharing-empty-message">Других пользователей с доступом пока нет.</p>
          ) : (
            <Card className="sharing-members-list">
            {editorMembers.map((member) => (
              <div className="sharing-member-row" key={member.user_id}>
                <span className="sharing-member-email">{member.email}</span>
                <Button
                  disabled={busy}
                  size="sm"
                  variant="ghost"
                  className="sharing-revoke"
                  onClick={() => setConfirm({
                    action: "revoke",
                    subject: member.user_id,
                    label: `Отозвать доступ ${member.email} к ${pet.name}? После этого пользователь больше не сможет видеть или изменять данные питомца.`,
                  })}
                >
                  Отозвать доступ
                </Button>
              </div>
            ))}
            </Card>
          )}
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
