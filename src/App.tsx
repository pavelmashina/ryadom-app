import {
  SectionHeader,
  Toast,
  Button,
  IconButton,
  Card,
  Empty,
  Modal,
  Form,
  Field,
  Select,
  Note,
  text,
  number,
} from "./components";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sharing, JoinPet, PetMembersSummary } from "./Sharing";
import { petAccess } from "./sharing-api";
import TrainingDateField from "./TrainingDateField";
import { rpc, type AuthSession } from "./backend";
import type { PersistOutcome } from "./cloud-data";
import type { TrainingSession } from "./training-domain";
import {
  PawPrint,
  Dog,
  ChevronDown,
  CalendarDays,
  Clock,
  HeartPulse,
  GraduationCap,
  Package,
  Download,
  ArrowLeft,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import Calendar from "./Calendar";
import AccountTrigger from "./AccountTrigger";
import { formatEventDetailDate } from "./event-detail-date";
import Training from "./Training";
import TrainingPlan from "./TrainingPlan";
import { cancelPlannedTraining, reschedulePlannedTraining } from "./training-actions";
import { trainingScheduleText } from "./training-detail";
import Health from "./Health";
import Stock from "./Stock";
import EventForm from "./EventForm";
import FirstPetSetup from "./FirstPetSetup";
import { needsFirstPetSetup, type PetBasics } from "./first-pet-setup";
import { saveWeight, deleteWeight, saveMedicalRecord, deleteMedicalRecord, deletePetDocument } from "./health-actions";
import { setSharedEventReminder } from "./push-api";
import {
  blankPet,
  today,
  fmt,
  id,
  completionKey,
  moveEvent,
  sessionSchema,
  petSchema,
  type Pet,
  type PetEvent,
  type State,
} from "./domain";
import { parseBackup, download } from "./storage";
import { recurrenceText, previousDay } from "./recurrence";
import { joinCodeFromUrl } from "./share-invitation";
import { completeShoppingItem, restoreShoppingItem } from "./shopping-checkout";
import {
  applyPendingShopping, readShoppingDrafts, writeShoppingDrafts,
  unsyncedShoppingError, type PendingShopping,
} from "./shopping-fast-save";
type Screen = "day" | "health" | "training" | "stock" | "profile" | "account";
type EventScope = "single" | "future" | "all";
type Overlay =
  | {
      kind: "event";
      category?: PetEvent["category"];
      name?: string;
      linkedRecord?: string;
    }
  | {
      kind: "detail";
      event: PetEvent;
      on: string;
    }
  | { kind: "trainingDetail"; sessionId: string }
  | { kind: "modifyTraining"; sessionId: string; action: "edit" | "delete" }
  | {
      kind: "session";
      command: string;
    }
  | {
      kind: "modifyEvent";
      eventId: string;
      on: string;
      action: "edit" | "delete";
    }
  | {
      kind: "finishShopping";
      itemId: string;
    }
  | {
      kind: "editWeight" | "editRecord" | "deleteWeight" | "deleteRecord" | "deleteDocument";
      entryId: string;
    }
  | {
      kind:
        | "pets"
        | "sharing"
        | "join"
        | "newpet"
        | "addPetChoice"
        | "editpet"
        | "deletePet"
        | "command"
        | "weight"
        | "record"
        | "summary"
        | "shopping"
        | "document"
        | "backup";
    };
const nav = [
  ["day", "День", CalendarDays],
  ["health", "Здоровье", HeartPulse],
  ["training", "Занятия", GraduationCap],
  ["stock", "Запасы", Package],
] as const;
export default function App({
  initial,
  onPersist,
  accountContent,
  onLogout,
  session,
  onRefresh,
}: {
  initial: State;
  onPersist: (next: State, before: State) => Promise<PersistOutcome>;
  accountContent: (pets: Pet[]) => ReactNode;
  onLogout: () => Promise<void>;
  session: AuthSession;
  onRefresh: () => Promise<State>;
}) {
  const loaded = { state: initial, error: "" };
  const shoppingPending = useRef<PendingShopping[]>(readShoppingDrafts(session.user.id));
  const serverState = useRef(initial);
  const liveState = useRef(applyPendingShopping(initial, shoppingPending.current));
  const shoppingSync = useRef<Promise<void> | null>(null);
  const saving = useRef(false);
  const epoch = useRef(0);
  const [openTraining, setOpenTraining] = useState<string | undefined>();
  const [showFirstPetSetup, setShowFirstPetSetup] = useState(() => needsFirstPetSetup(initial));
  const handledPushLink = useRef(false);
  const handledTrainingLink = useRef(false);
  const handledJoinLink = useRef(false);
  const handledStockLink = useRef(false);
  const [stockTarget,setStockTarget] = useState<string | undefined>();
  const [joinCode, setJoinCode] = useState<string | null>(() => joinCodeFromUrl(location.search));
  const [eventScope, setEventScope] = useState<EventScope>("single");
  const [trainingDeleteScope, setTrainingDeleteScope] = useState<"one" | "following">("one");
  const [busy, setBusy] = useState(false);
  const [leavingAccount, setLeavingAccount] = useState(false);
  const [state, setState] = useState(liveState.current),
    [storageError, setStorageError] = useState(loaded.error),
    [notice, setNotice] = useState(""),
    [screen, setScreen] = useState<Screen>("day"),
    [accountReturnScreen, setAccountReturnScreen] = useState<Screen>("day"),
    [profileReturnScreen, setProfileReturnScreen] = useState<Screen>("account"),
    [overlay, setOverlay] = useState<Overlay | null>(null),
    [petMenuOpen, setPetMenuOpen] = useState(false),
    [selected, setSelected] = useState(today()),
    [month, setMonth] = useState(today().slice(0, 7) + "-01"),
    [restore, setRestore] = useState<State | null>(null);
  useEffect(() => {
    if (!petMenuOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const oldHtmlOverflow = html.style.overflow;
    const oldHtmlOverscroll = html.style.overscrollBehavior;
    const oldBodyOverflow = body.style.overflow;
    const oldBodyOverscroll = body.style.overscrollBehavior;
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    const closeOnEscape = (e: KeyboardEvent) => {
      if(e.key === "Escape") setPetMenuOpen(false);
    };
    window.addEventListener("keydown",closeOnEscape);
    return () => {
      html.style.overflow = oldHtmlOverflow;
      html.style.overscrollBehavior = oldHtmlOverscroll;
      body.style.overflow = oldBodyOverflow;
      body.style.overscrollBehavior = oldBodyOverscroll;
      window.removeEventListener("keydown",closeOnEscape);
    };
  }, [petMenuOpen]);
  const hasPets = state.pets.length > 0;
  // Stable temporary data allows read-only browsing without ever saving a fake pet.
  const [unselectedPet] = useState(() => blankPet("Питомец"));
  const pet = state.pets.find((p) => p.id === state.selectedPet) ?? state.pets[0] ?? unselectedPet;
  useEffect(() => {
    if (handledTrainingLink.current) return;
    const params = new URLSearchParams(location.search);
    const trainingId = params.get("training");
    if (!trainingId || !/^[0-9a-f-]{36}$/i.test(trainingId)) return;
    handledTrainingLink.current = true;
    const matchingPet = state.pets.find((p) => p.workouts.some((w) => w.id === trainingId));
    if (matchingPet) {
      if (matchingPet.id !== state.selectedPet) setState((current) => ({
        ...current, selectedPet: matchingPet.id,
      }));
      setOpenTraining(trainingId);
      setScreen("training");
      setOverlay(null);
    } else {
      setNotice("Тренировка из уведомления больше недоступна. Откройте календарь занятий.");
      setScreen("training");
    }
    params.delete("training");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash);
  }, [state]);
  useEffect(() => {
    if (handledJoinLink.current) return;
    const code = joinCodeFromUrl(location.search);
    if (!code) return;
    handledJoinLink.current = true;
    setJoinCode(code);
    setOverlay({ kind: "join" });
    const params = new URLSearchParams(location.search);
    params.delete("join");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash);
  }, []);
  useEffect(() => {
    if (handledPushLink.current) return;
    const params = new URLSearchParams(location.search);
    const eventId = params.get("event");
    if (!eventId) return;
    const matchedPet = state.pets.find((p) => p.events.some((e) => e.id === eventId));
    const event = matchedPet?.events.find((e) => e.id === eventId);
    if (!matchedPet || !event) return;
    const day = /^\\d{4}-\\d{2}-\\d{2}$/.test(params.get("date") || "")
      ? params.get("date")! : event.date;
    handledPushLink.current = true;
    if (matchedPet.id !== state.selectedPet) setState((previous) => ({
      ...previous, selectedPet: matchedPet.id,
    }));
    setSelected(day);
    setMonth(day.slice(0, 7) + "-01");
    setScreen("day");
    setOverlay({ kind: "detail", event, on: day });
    history.replaceState(null, "", location.pathname + location.hash);
  }, [state]);
  useEffect(() => {
    if (handledStockLink.current) return;
    const params = new URLSearchParams(location.search);
    const targetPet = params.get("stockPet");
    if (!targetPet || !state.pets.some((p) => p.id === targetPet)) return;
    handledStockLink.current = true;
    const stockId = params.get("stock");
    setStockTarget(stockId || undefined);
    setState((previous) => ({...previous,selectedPet:targetPet}));
    setScreen("stock");
    setOverlay(null);
    history.replaceState(null,"",location.pathname+location.hash);
  },[state]);

  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    let stopped = false,
      running = false;
    async function refresh() {
      if (running || saving.current || document.hidden) return;
      running = true;
      const stamp = epoch.current;
      try {
        const next = await refreshRef.current();
        if (stopped || saving.current || stamp !== epoch.current) return;
        setState((previous) => {
          if (shoppingPending.current.length) return previous;
          const lost = previous.pets.some(
            (p) => !next.pets.some((n) => n.id === p.id),
          );
          if (
            document.querySelector("dialog[open]") &&
            !lost &&
            overlayRef.current?.kind !== "join"
          )
            return previous;
          if (lost) {
            setOverlay(null);
            setNotice(
              "Список питомцев обновлён. Доступ к одному из питомцев прекращён.",
            );
          }
          if (JSON.stringify(previous) === JSON.stringify(next))
            return previous;
          const resolved = {
            ...next,
            selectedPet: next.pets.some((p) => p.id === previous.selectedPet)
              ? previous.selectedPet
              : next.selectedPet,
          };
          serverState.current = resolved;
          liveState.current = resolved;
          return resolved;
        });
      } catch {
        /* Keep the current draft during a transient network failure. Writes still require server authorization. */
      } finally {
        running = false;
      }
    }
    // A less aggressive sync cadence avoids unnecessary mobile reconnects.
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  async function refreshNow() {
    if (shoppingSync.current) await shoppingSync.current;
    if (shoppingPending.current.length) throw new Error("Дождитесь синхронизации покупок");
    ++epoch.current;
    const next = await onRefresh();
    serverState.current = next;
    liveState.current = next;
    setState(next);
    if (!next.pets.some((p) => p.id === pet.id)) close();
  }

  /** Purchased items appear instantly; the cloud transaction is serialized and retried.
   * The same UUID on retry avoids duplicate rows, including an accepted-but-lost response.
   */
  function flushShopping(): Promise<void> {
    if (shoppingSync.current) return shoppingSync.current;
    if (!shoppingPending.current.length || saving.current) return Promise.resolve();
    const task = (async () => {
      saving.current = true;
      ++epoch.current; // Cancel any stale refresh that started before this save.
      try {
        while (shoppingPending.current.length) {
          const before = serverState.current;
          const batch = shoppingPending.current.slice();
          const next = applyPendingShopping(before, batch);
          let stored: PersistOutcome | undefined;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              stored = await onPersist(next, before);
              break;
            } catch (cause) {
              const transient = cause instanceof Error &&
                /нет связи|network|fetch|timeout|timed out|abort/i.test(cause.message);
              if (!transient || attempt === 1) throw cause;
              await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
            }
          }
          if (!stored) throw new Error("Не удалось подтвердить сохранение");
          serverState.current = stored.state;
          const savedIds = new Set(batch.map(({ item }) => item.id));
          shoppingPending.current = shoppingPending.current.filter(({ item }) => !savedIds.has(item.id));
          writeShoppingDrafts(session.user.id, shoppingPending.current);
          const merged = applyPendingShopping(stored.state, shoppingPending.current);
          const selectedPet = liveState.current.selectedPet;
          liveState.current = merged.pets.some((p) => p.id === selectedPet)
            ? { ...merged, selectedPet } : merged;
          setState(liveState.current);
          setStorageError("");
          setNotice("Покупка сохранена в облаке");
        }
      } catch (cause) {
        setNotice(unsyncedShoppingError(cause));
      } finally {
        saving.current = false;
        ++epoch.current;
      }
    })();
    shoppingSync.current = task;
    void task.finally(() => { shoppingSync.current = null; });
    return task;
  }

  function addShoppingInstantly(data: FormData) {
    const name = text(data, "name");
    if (!name) throw new Error("Укажите название покупки");
    const entry: PendingShopping = {
      petId: pet.id,
      item: { id: id(), name, quantity: text(data, "quantity"), done: false },
    };
    shoppingPending.current.push(entry);
    writeShoppingDrafts(session.user.id, shoppingPending.current);
    const next = applyPendingShopping(liveState.current, [entry]);
    liveState.current = next;
    setState(next);
    ++epoch.current;
    close();
    setNotice("Покупка добавлена в список");
    void flushShopping();
  }

  useEffect(() => {
    if (shoppingPending.current.length) void flushShopping();
    const retry = () => {
      if (shoppingPending.current.length && !document.hidden) void flushShopping();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);

  async function commit(next: State) {
    if (shoppingSync.current) await shoppingSync.current;
    if (shoppingPending.current.length)
      throw new Error("Покупки ещё не синхронизированы. Проверьте соединение.");
    if (saving.current) throw new Error("Дождитесь завершения сохранения");
    saving.current = true;
    ++epoch.current;
    setBusy(true);
    setNotice("Сохраняем в облаке…");
    try {
      const stored = await onPersist(next, serverState.current);
      serverState.current = stored.state;
      liveState.current = stored.state;
      setState(stored.state);
      setStorageError("");
      setNotice(stored.combined
        ? "Сохранено в облаке. Изменения другого участника тоже сохранены."
        : "Сохранено в облаке");
    } catch (e) {
      setNotice("Не удалось сохранить: " + (e instanceof Error ? e.message : "ошибка связи"));
      throw e;
    } finally {
      saving.current = false;
      setBusy(false);
      if (shoppingPending.current.length) void flushShopping();
    }
  }
  async function finishFirstPetSetup(details?: PetBasics) {
    await update((p) => petSchema.parse({ ...p, ...details, onboardingCompleted: true }));
    setShowFirstPetSetup(false);
    setScreen("day");
  }
  async function update(fn: (p: Pet) => Pet) {
    if (shoppingSync.current) await shoppingSync.current;
    if (shoppingPending.current.length)
      throw new Error("Покупки ещё не синхронизированы. Проверьте соединение.");
    const previous = liveState.current;
    return commit({
      ...previous,
      pets: previous.pets.map((p) =>
        p.id === pet.id ? petSchema.parse(fn(p)) : p,
      ),
    });
  }
  async function safe(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }
  function close() {
    setOverlay(null);
  }
  async function saved(fn: () => void | Promise<void>) {
    await fn();
    close();
  }
  async function addEvent(e: PetEvent) {
    await saved(() => update((p) => ({ ...p, events: [...p.events, e] })));
    if (e.reminderEnabled) await syncSharedReminder(e.id, e);
    setSelected(e.date);
    setMonth(e.date.slice(0, 7) + "-01");
    setScreen("day");
  }
  function modifyTraining(workout: TrainingSession, action: "edit" | "delete") {
    setTrainingDeleteScope("one");
    setOverlay({ kind: "modifyTraining", sessionId: workout.id, action });
  }
  async function deleteTraining(workout: TrainingSession, scope: "one" | "following") {
    await saved(() => update(p => cancelPlannedTraining(p, workout.id, scope)));
  }
  function modifyEvent(e: PetEvent, on: string, action: "edit" | "delete") {
    // Editing a recurring series must show its saved recurrence/end settings
    // on opening; the one-occurrence option remains available explicitly.
    setEventScope(e.repeat === "once" ? "all" : action === "edit" ? "all" : "single");
    setOverlay({ kind: "modifyEvent", eventId: e.id, on, action });
  }
  async function syncSharedReminder(eventId: string, event: PetEvent) {
    try {
      await setSharedEventReminder(session, pet.id, eventId, Number(event.reminder), !!event.reminderEnabled);
    } catch (error) {
      console.warn("[reminder] event saved but shared reminder sync failed", error);
      setNotice("Событие сохранено, но общее напоминание не обновилось. Откройте карточку события и сохраните напоминание повторно.");
    }
  }
  async function saveEventEdit(e: PetEvent, on: string, scope: EventScope, next: PetEvent) {
    // Editing one occurrence or a future series creates a distinct event ID.
    // Attach the shared reminder to the new ID, not the old series.
    const targetId = e.repeat !== "once" && scope !== "all" ? id() : e.id;
    await saved(() =>
      update((p) => {
        if (e.repeat === "once" || scope === "all")
          return {
            ...p,
            events: p.events.map((x) => x.id === e.id ? { ...next, id: e.id } : x),
          };
        const events = p.events.map((x) => x.id === e.id ? x : x);
        if (scope === "single") {
          const cancelled = {
            ...e,
            exceptions: [
              ...(e.exceptions ?? []).filter((x) => x.on !== on),
              { on, cancelled: true },
            ],
          };
          return {
            ...p,
            events: [
              ...events.map((x) => x.id === e.id ? cancelled : x),
              {
                ...next,
                id: targetId,
                repeat: "once" as const,
                end: "",
                repeatEndType: undefined,
                repeatCount: undefined,
                exceptions: undefined,
              },
            ],
          };
        }
        const past = {
          ...e,
          end: previousDay(on),
          repeatEndType: "date" as const,
          repeatCount: undefined,
          exceptions: (e.exceptions ?? []).filter((x) => x.on < on),
        };
        return {
          ...p,
          events: [
            ...events.filter((x) => x.id !== e.id),
            ...(on === e.date ? [] : [past]),
            { ...next, id: targetId, exceptions: undefined },
          ],
        };
      }),
    );
    await syncSharedReminder(targetId, next);
    setSelected(next.date);
    setMonth(next.date.slice(0, 7) + "-01");
  }
  async function deleteEvent(e: PetEvent, on: string, scope: EventScope) {
    await saved(() =>
      update((p) => {
        if (e.repeat === "once" || scope === "all" || (scope === "future" && on === e.date)) {
          return {
            ...p,
            events: p.events.filter((x) => x.id !== e.id),
            done: Object.fromEntries(Object.entries(p.done).filter(([key]) => !key.startsWith(e.id + ":"))),
          };
        }
        const altered = scope === "single"
          ? {
              ...e,
              exceptions: [
                ...(e.exceptions ?? []).filter((x) => x.on !== on),
                { on, cancelled: true },
              ],
            }
          : {
              ...e,
              end: previousDay(on),
              repeatEndType: "date" as const,
              repeatCount: undefined,
              exceptions: (e.exceptions ?? []).filter((x) => x.on < on),
            };
        return {
          ...p,
          events: p.events.map((x) => x.id === e.id ? altered : x),
        };
      }),
    );
  }
  function toggle(e: PetEvent, s: string) {
    safe(() =>
      update((p) => ({
        ...p,
        done: {
          ...p.done,
          [completionKey(e, s)]: !p.done[completionKey(e, s)],
        },
      })),
    );
  }
  function choose(p: Pet) {
    safe(async () => {
      await commit({ ...state, selectedPet: p.id });
      setPetMenuOpen(false);
      setShowFirstPetSetup(false);
      close();
      setScreen("day");
      setSelected(today());
      setMonth(today().slice(0, 7) + "-01");
    });
  }
  function openAccount() {
    // Preserve the actual source screen instead of always returning to Day.
    if (screen !== "account") setAccountReturnScreen(screen);
    setScreen("account");
    setPetMenuOpen(false);
    setNotice("");
    window.scrollTo({ top: 0 });
  }
  function leaveAccount() {
    setScreen(accountReturnScreen === "account" ? "day" : accountReturnScreen);
    window.scrollTo({ top: 0 });
  }
  function openPetMenu() {
    if (!hasPets) { setOverlay({ kind: "addPetChoice" }); return; }
    setPetMenuOpen(value => !value);
  }
  function addPetChoice() {
    setPetMenuOpen(false);
    setOverlay({ kind: "addPetChoice" });
  }
  function goToPetSettings(p: Pet) {
    safe(async () => {
      if (p.id !== state.selectedPet) await commit({ ...state, selectedPet: p.id });
      setProfileReturnScreen(screen);
      setPetMenuOpen(false);
      close();
      setScreen("profile");
      window.scrollTo({ top: 0 });
    });
  }
  function leavePetProfile() {
    setScreen(profileReturnScreen === "profile" ? "account" : profileReturnScreen);
    window.scrollTo({ top: 0 });
  }
  function exportData() {
    download(`ryadom-backup-${today()}.json`, JSON.stringify(state, null, 2));
    setNotice("Резервная копия подготовлена");
  }
  const title =
    overlay?.kind === "event"
      ? "Новое событие"
      : overlay?.kind === "detail"
        ? overlay.event.name
        : overlay?.kind === "trainingDetail"
          ? pet.workouts.find(w => w.id === overlay.sessionId)?.name || "Тренировка"
        : overlay?.kind === "modifyTraining"
          ? overlay.action === "edit" ? "Редактировать тренировку" : "Удалить тренировку"
        : overlay?.kind === "modifyEvent"
          ? overlay.action === "edit" ? "Редактировать событие" : "Удалить событие"
        : overlay?.kind === "session"
          ? `Занятие · ${pet.commands.find((c) => c.id === overlay.command)?.name}`
          : (
              {
                pets: "Мои питомцы",
                sharing: "Совместный доступ",
                join: "Добавить существующего питомца",
                newpet: "Новый питомец",
                addPetChoice: "Добавить питомца",
                editpet: "Данные питомца",
                deletePet: "Удалить питомца",
                command: "Новая команда",
                weight: "Записать вес",
                editWeight: "Редактировать вес",
                deleteWeight: "Удалить измерение",
                record: "Медицинская запись",
                editRecord: "Редактировать медицинскую запись",
                deleteRecord: "Удалить медицинскую запись",
                deleteDocument: "Удалить документ",
                summary: "Сводка для ветеринара",
                shopping: "Новая покупка",
                finishShopping: "Покупка выполнена",
                document: "Добавить документ",
                backup: "Резервные копии",
              } as Record<string, string>
            )[overlay?.kind || ""];
  function modalBody() {
    if (!overlay) return null;
    switch (overlay.kind) {
      case "addPetChoice":
        return <div className="pet-add-choices">
          <Button fullWidth variant="secondary" onClick={() => setOverlay({ kind: "newpet" })}>
            <Plus aria-hidden="true" /> Создать нового питомца
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setOverlay({ kind: "join" })}>
            <Dog aria-hidden="true" /> Добавить с помощью кода
          </Button>
        </div>;
      case "sharing":
        return <div className="standard-pet-modal pet-sharing-modal"><Sharing session={session} pet={pet} onChanged={refreshNow} /></div>;
      case "join":
        return <JoinPet session={session} onChanged={refreshNow} initialCode={joinCode} />;
      case "event":
        return (
          <EventForm
            selected={selected}
            session={session}
            pet={pet}
            onTrainingSave={(next) => update(() => next)}
            onTrainingComplete={close}
            category={overlay.category}
            name={overlay.name}
            linkedRecord={overlay.linkedRecord}
            onSave={addEvent}
          />
        );
      case "modifyEvent": {
        const current = pet.events.find((e) => e.id === overlay.eventId);
        if (!current) return <p>Событие больше недоступно.</p>;
        const scope = current.repeat === "once" ? "all" : eventScope;
        const editSource: PetEvent = scope === "all"
          ? current
          : {
              ...current,
              date: overlay.on,
              ...(scope === "single"
                ? { repeat: "once" as const, end: "", repeatEndType: undefined, repeatCount: undefined }
                : {}),
              exceptions: undefined,
            };
        return (
          <div className="event-modify-modal">
            {current.repeat !== "once" && (
              <Select
                label={overlay.action === "edit" ? "Изменить" : "Удалить"}
                value={scope}
                onChange={(e) => setEventScope(e.target.value as EventScope)}
              >
                <option value="single">Только это событие</option>
                <option value="future">Это и последующие</option>
                {overlay.action === "edit" && <option value="all">Все события серии</option>}
              </Select>
            )}
            {overlay.action === "edit" ? (
              <EventForm
                key={scope}
                selected={overlay.on}
                existing={editSource}
                session={session}
                onSave={(next) => saveEventEdit(current, overlay.on, scope, next)}
              />
            ) : (
              <div>
                <p>Выбранные события будут удалены из календаря.</p>
                <Button fullWidth variant="primary"
                  onClick={() => safe(() => deleteEvent(current, overlay.on, scope))}>
                  Удалить
                </Button>
              </div>
            )}
          </div>
        );
      }
      case "trainingDetail": {
        const workout = pet.workouts.find(w => w.id === overlay.sessionId);
        if (!workout || workout.status === "cancelled")
          return <p>Тренировка больше недоступна.</p>;
        const schedule = pet.trainingSchedules?.find(s => s.id === workout.schedule_id);
        const time = workout.time || schedule?.time_of_day?.slice(0, 5) || "";
        const comment = workout.comment || schedule?.comment || "";
        return (
          <div className="event-detail-modal training-day-detail">
            <Card className="event-detail-summary">
              <h3 className="event-detail-datetime">
                <Clock aria-hidden="true" />
                <span>{formatEventDetailDate(workout.date, time)}</span>
              </h3>
              <p>Тренировка · {trainingScheduleText(schedule)}</p>
              {comment.trim() && <p className="note">{comment}</p>}
            </Card>
            <div className="fields event-detail-actions">
              <Button variant="secondary" onClick={() =>
                workout.status === "planned"
                  ? modifyTraining(workout, "edit")
                  : (setOpenTraining(workout.id), setScreen("training"), close())}>
                Изменить
              </Button>
              <Button variant="destructive" className="event-detail-delete"
                disabled={workout.status !== "planned"}
                onClick={() => modifyTraining(workout, "delete")}>
                Удалить
              </Button>
            </div>
            {workout.status === "planned" && !schedule && (
              <Form label="Перенести" onSave={async data => {
                const to = text(data, "date");
                await saved(() => update(p => reschedulePlannedTraining(
                  p, workout.id, to, workout.time || "",
                )));
                setSelected(to);
                setMonth(to.slice(0, 7) + "-01");
              }}>
                <TrainingDateField label="Перенести на дату" name="date"
                  defaultValue={workout.date} required />
              </Form>
            )}
          </div>
        );
      }
      case "modifyTraining": {
        const workout = pet.workouts.find(w => w.id === overlay.sessionId);
        if (!workout || workout.status !== "planned")
          return <p>Эта тренировка больше не запланирована.</p>;
        const schedule = pet.trainingSchedules?.find(s => s.id === workout.schedule_id);
        return (
          <div className={overlay.action === "edit"
            ? "training-modal-content training-day-modify"
            : "event-modify-modal training-day-modify"}>
            {overlay.action === "edit" ? (
              <TrainingPlan pet={pet} auth={session} session={workout}
                schedule={schedule}
                onSave={async next => {
                  await update(() => next);
                  if (schedule) {
                    const changed = await rpc(session, "materialize_training_month", {
                      p_pet: pet.id, p_month: workout.date.slice(0, 7) + "-01",
                    });
                    if (changed) await refreshNow();
                  }
                }}
                onComplete={close} />
            ) : (
              <>
                {schedule && <Select label="Удалить" value={trainingDeleteScope}
                  onChange={e => setTrainingDeleteScope(e.target.value as "one" | "following")}>
                  <option value="one">Только эту тренировку</option>
                  <option value="following">Эту и все последующие</option>
                </Select>}
                <p>{schedule
                  ? "Выбранные тренировки будут удалены из календаря."
                  : "Удалить запланированную тренировку?"}</p>
                <Button fullWidth variant="destructive"
                  onClick={() => safe(() => deleteTraining(workout, schedule ? trainingDeleteScope : "one"))}>
                  Удалить
                </Button>
              </>
            )}
          </div>
        );
      }
      case "detail": {
        const e = pet.events.find((e) => e.id === overlay.event.id)!;
        const done = pet.done[completionKey(e, overlay.on)];
        return (
          <div className="event-detail-modal">
            <Card className="event-detail-summary">
              <h3 className="event-detail-datetime">
                <Clock aria-hidden="true" />
                <span>{formatEventDetailDate(overlay.on, e.time)}</span>
              </h3>
              <p>{e.kind === "reminder" ? "Напоминание" : "Событие"} · {recurrenceText(e)}</p>
              {e.note?.trim() && <p className="note">{e.note}</p>}
            </Card>
            <Button
              onClick={() => toggle(e, overlay.on)}
              fullWidth
              variant="primary"
            >
              {done ? "Снять отметку о выполнении" : "Отметить выполненным"}
            </Button>
            <div className="fields event-detail-actions">
              <Button onClick={() => modifyEvent(e, overlay.on, "edit")} variant="secondary">
                Изменить
              </Button>
              <Button onClick={() => modifyEvent(e, overlay.on, "delete")}
                variant="destructive" className="event-detail-delete">
                Удалить
              </Button>
            </div>
            {e.repeat === "once" && !done && (
              <Form
                label="Перенести"
                onSave={async (d) => {
                  const to = text(d, "date");
                  await saved(() => update((p) => moveEvent(p, e.id, to)));
                  setSelected(to);
                  setMonth(to.slice(0, 7) + "-01");
                }}
              >
                <TrainingDateField
                  label="Перенести на дату"
                  name="date"
                  defaultValue={e.date}
                  required
                />
              </Form>
            )}
          </div>
        );
      }
      case "pets":
        return <div className="pet-access-list">
          {state.pets.map(p=><div className="account-pet-row" key={p.id}>
            <span><strong>{p.name}</strong><small>{p.role==="editor"?"Совместный доступ":"Владелец"}</small></span>
            <Button size="sm" variant="secondary" onClick={()=>goToPetSettings(p)}>
              <Settings aria-hidden="true" /> Управление
            </Button>
          </div>)}
          <Button fullWidth variant="secondary" onClick={addPetChoice}>
            <Plus aria-hidden="true" /> Добавить питомца
          </Button>
        </div>;
      case "newpet":
        return (
          <div className="new-pet-form">
          <Form
            onSave={async (d) => {
              const p = blankPet(text(d, "name"));
              petSchema.parse(p);
              await saved(() =>
                commit({
                  ...state,
                  pets: [...state.pets, p],
                  selectedPet: p.id,
                }),
              );
              setProfileReturnScreen(screen);
              setScreen("profile");
            }}
          >
            <Field label="Имя" name="name" required maxLength={80} />
            <p className="hint">
              У нового питомца будут собственные календарь, здоровье, занятия и
              запасы.
            </p>
          </Form>
          </div>
        );
      case "editpet":
        return (
          <div className="standard-pet-modal pet-editor-modal">
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  name: text(d, "name"),
                  breed: text(d, "breed"),
                  birthday: text(d, "birthday"),
                  sex: text(d, "sex") as Pet["sex"],
                  chip: text(d, "chip"),
                })),
              )
            }
          >
            <Field
              label="Имя"
              name="name"
              defaultValue={pet.name}
              required
              maxLength={80}
            />
            <Field
              label="Порода"
              name="breed"
              defaultValue={pet.breed}
              maxLength={120}
            />
            <TrainingDateField
              label="Дата рождения"
              name="birthday"
              max={today()}
              defaultValue={pet.birthday}
            />
            <Select label="Пол" name="sex" defaultValue={pet.sex}>
              <option value="">Не указан</option>
              <option>Девочка</option>
              <option>Мальчик</option>
            </Select>
            <Field
              label="Номер чипа"
              name="chip"
              defaultValue={pet.chip}
              maxLength={100}
            />
          </Form>
          </div>
        );
      case "deletePet":
        return (
          <div className="standard-pet-modal pet-delete-modal">
            <Form
              label="Удалить питомца"
              variant="destructive"
              onSave={async () => {
                await petAccess(session, "delete", { target: pet.id });
                await refreshNow();
                setScreen("account");
                close();
                setNotice("Питомец удалён");
                window.scrollTo({ top: 0 });
              }}
            >
              <p>Удалить питомца {pet.name}? Его данные станут недоступны всем участникам.</p>
            </Form>
          </div>
        );
      case "command":
        return (
          <Form
            onSave={async (d) => {
              const name = text(d, "name");
              if (!name) throw new Error("Введите название команды");
              if (
                pet.commands.some(
                  (c) => c.name.toLowerCase() === name.toLowerCase(),
                )
              )
                throw new Error("Такая команда уже есть");
              await saved(() =>
                update((p) => ({
                  ...p,
                  commands: [...p.commands, { id: id(), name }],
                })),
              );
            }}
          >
            <Field
              label="Название команды"
              name="name"
              placeholder="Например, Ко мне"
              required
              maxLength={80}
            />
          </Form>
        );
      case "session":
        return (
          <Form
            label="Сохранить результат"
            onSave={async (d) => {
              const s = sessionSchema.safeParse({
                id: id(),
                command: overlay.command,
                date: text(d, "date"),
                good: number(d, "good"),
                total: number(d, "total"),
                minutes: number(d, "minutes"),
                note: text(d, "note"),
              });
              if (!s.success) throw new Error(s.error.issues[0].message);
              if (s.data.date > today())
                throw new Error("Нельзя записать результат будущего занятия");
              await saved(() =>
                update((p) => ({ ...p, sessions: [...p.sessions, s.data] })),
              );
            }}
          >
            <Field
              label="Дата занятия"
              name="date"
              type="date"
              defaultValue={today()}
              max={today()}
              required
            />
            <div className="fields">
              <Field
                label="Успешно"
                name="good"
                type="number"
                min="0"
                max="1000"
                step="1"
                required
              />
              <Field
                label="Всего повторов"
                name="total"
                type="number"
                min="1"
                max="1000"
                step="1"
                required
              />
            </div>
            <Field
              label="Длительность, минут"
              name="minutes"
              type="number"
              min="1"
              max="600"
              step="1"
              required
            />
            <Note label="Как прошло?" />
            <p className="hint">
              Записывайте фактические наблюдения. После сохранения шкала этой
              команды обновится.
            </p>
          </Form>
        );
      case "weight":
      case "editWeight": {
        const existing = overlay.kind === "editWeight"
          ? pet.weights.find((w) => w.id === overlay.entryId) : undefined;
        if (overlay.kind === "editWeight" && !existing)
          return <p role="alert">Измерение больше недоступно.</p>;
        return (
          <>
            <Form label={existing ? "Сохранить вес" : "Добавить измерение"}
              onSave={async (d) => {
                await saved(() => update((p) => saveWeight(p, {
                  id: existing?.id ?? id(),
                  date: text(d, "date"),
                  value: number(d, "value"),
                })));
              }}
            >
              <Field label="Вес, кг" name="value" type="number" min="0.01"
                max="300" step="0.01" defaultValue={existing?.value ?? ""} required />
              <Field label="Дата измерения" name="date" type="date"
                defaultValue={existing?.date ?? today()} max={today()} required />
            </Form>
            {existing && (
              <Button fullWidth variant="ghost" onClick={() =>
                setOverlay({ kind: "deleteWeight", entryId: existing.id })
              }>Удалить измерение</Button>
            )}
          </>
        );
      }
      case "record":
      case "editRecord": {
        const existing = overlay.kind === "editRecord"
          ? pet.records.find((r) => r.id === overlay.entryId) : undefined;
        if (overlay.kind === "editRecord" && !existing)
          return <p role="alert">Медицинская запись больше недоступна.</p>;
        return (
          <>
            <Form label={existing ? "Сохранить изменения" : "Добавить запись"}
              onSave={async (d) => {
                await saved(() => update((p) => saveMedicalRecord(p, {
                  id: existing?.id ?? id(),
                  name: text(d, "name"),
                  date: text(d, "date"),
                  type: text(d, "type") as Pet["records"][number]["type"],
                  note: text(d, "note"),
                })));
              }}
            >
              <Select label="Тип записи" name="type" defaultValue={existing?.type ?? "Визит"}>
                {["Визит", "Анализы / УЗИ", "Прививка", "Назначение"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <Field label="Название" name="name" defaultValue={existing?.name ?? ""}
                required maxLength={120} />
              <Field label="Дата" name="date" type="date"
                defaultValue={existing?.date ?? today()} max={today()} required />
              <Note label="Результат или назначение" value={existing?.note ?? ""} />
              <p className="hint">После сохранения запись можно связать с событием. Файлы добавляются в документы профиля.</p>
            </Form>
            {existing && (
              <Button fullWidth variant="ghost" onClick={() =>
                setOverlay({ kind: "deleteRecord", entryId: existing.id })
              }>Удалить медицинскую запись</Button>
            )}
          </>
        );
      }
      case "deleteWeight":
      case "deleteRecord":
      case "deleteDocument": {
        const kind = overlay.kind;
        const entryId = overlay.entryId;
        const record = pet.records.find((r) => r.id === entryId);
        const documentEntry = pet.documents.find((d) => d.id === entryId);
        const exists = kind === "deleteWeight"
          ? pet.weights.some((w) => w.id === entryId)
          : kind === "deleteRecord" ? !!record : !!documentEntry;
        if (!exists) return <p role="alert">Запись больше недоступна.</p>;
        return (
          <Form label="Да, удалить" variant="destructive"
            onSave={async () => {
              await saved(() => update((p) => kind === "deleteWeight"
                ? deleteWeight(p, entryId)
                : kind === "deleteRecord"
                  ? deleteMedicalRecord(p, entryId)
                  : deletePetDocument(p, entryId)));
            }}
          >
            <p>Подтвердите удаление. Это действие нельзя отменить.</p>
            {kind === "deleteRecord" && pet.events.some((e) => e.linkedRecord === entryId) && (
              <p className="hint">Связанные события останутся в календаре, но связь с записью будет удалена.</p>
            )}
            {kind === "deleteDocument" && (
              <p className="hint">Файл «{documentEntry?.name}» будет удалён из карточки питомца и общей истории.</p>
            )}
          </Form>
        );
      }
      case "summary":
        return (
          <>
            <p className="notice">
              Предпросмотр сводки. Экспорт PDF пока не реализован.
            </p>
            <h3>
              {pet.name}
              {pet.demo ? " · демонстрационный пример" : ""}
            </h3>
            <p>
              {pet.breed || "Порода не указана"} ·{" "}
              {pet.birthday
                ? `Дата рождения: ${fmt(pet.birthday, { day: "numeric", month: "long", year: "numeric" })}`
                : "Дата рождения не указана"}{" "}
              · {pet.sex || "Пол не указан"}
            </p>
            <p>Чип: {pet.chip || "Не указан"}</p>
            <h3>История веса</h3>
            {pet.weights.length ? (
              pet.weights.map((w) => (
                <p key={w.id}>
                  {fmt(w.date)} · {w.value} кг
                </p>
              ))
            ) : (
              <p>Измерений нет.</p>
            )}
            <h3>Медицинские записи</h3>
            {pet.records.length ? (
              pet.records.map((r) => (
                <Card key={r.id}>
                  <strong>
                    {r.type}: {r.name}
                  </strong>
                  <p>{fmt(r.date)}</p>
                  <p className="note">{r.note || "Без заметки"}</p>
                </Card>
              ))
            ) : (
              <p>Записей нет.</p>
            )}
          </>
        );
      case "finishShopping": {
        const item = pet.shopping.find((x) => x.id === overlay.itemId);
        if (!item || item.done) return <p role="alert">Покупка уже выполнена или удалена.</p>;
        return (
          <Form label="Подтвердить покупку"
            onSave={async (data) => {
              const raw = text(data, "addedKg");
              const amount = raw ? Number(raw) : 0;
              // First credit the new stock ledger with an idempotent purchase key.
              // A failed JSON checklist save can be retried without crediting twice.
              if (amount > 0) await rpc(session,"stock_mutate",{
                p_pet:pet.id,p_action:"shopping_credit",
                p_data:{amount,purchase_id:item.id},
              });
              await saved(() => update((p) => completeShoppingItem(p, item.id, amount, today())));
              if (amount > 0) window.dispatchEvent(new Event("ryadom:stock-changed"));
            }}
          >
            <p><strong>{item.name}</strong>{item.quantity ? " · " + item.quantity : ""}</p>
            <Field label="Сколько корма добавить в запас, кг · необязательно"
              name="addedKg" type="number" min={0} max={100} step={0.001}
              disabled={(item.stockCreditedKg ?? 0) > 0}
              placeholder="Например, 2.5" />
            {(item.stockCreditedKg ?? 0) > 0 ? (
              <p className="hint">По этой покупке ранее уже добавлено {item.stockCreditedKg} кг корма. Повторное пополнение отключено.</p>
            ) : (
              <p className="hint">Если купили не корм, оставьте поле пустым: покупка отметится выполненной, а запас не изменится.</p>
            )}
          </Form>
        );
      }
      case "shopping":
        return (
          <Form onSave={addShoppingInstantly}>
            <Field label="Что купить?" name="name" required maxLength={120} />
            <Field
              label="Количество"
              name="quantity"
              placeholder="Например, 2 упаковки"
              maxLength={120}
            />
          </Form>
        );
      case "document":
        return (
          <div className="standard-pet-modal pet-document-modal">
          <Form
            onSave={async (d) => {
              const file = d.get("file") as File;
              if (
                ![
                  "application/pdf",
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                ].includes(file.type)
              )
                throw new Error("Выберите PDF, PNG, JPEG или WebP");
              if (file.size > 2 * 1024 * 1024)
                throw new Error("Размер файла должен быть не больше 2 МБ");
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () =>
                  reject(new Error("Не удалось прочитать файл"));
                reader.readAsDataURL(file);
              });
              await saved(() =>
                update((p) => ({
                  ...p,
                  documents: [
                    ...p.documents,
                    {
                      id: id(),
                      name: text(d, "name"),
                      filename: file.name,
                      data,
                    },
                  ],
                })),
              );
            }}
          >
            <Field label="Название" name="name" required maxLength={120} />
            <Field
              label="Файл · до 2 МБ"
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              required
            />
            <p className="hint">
              Файл сохраняется в вашем аккаунте и входит в резервную копию.
              Доступен активным участникам питомца после входа.
            </p>
          </Form>
          </div>
        );
      case "backup":
        return (
          <div className="standard-pet-modal pet-backup-modal">
            <p>
              Данные сохраняются в вашем аккаунте. Резервная копия включает всех
              питомцев и документы.
            </p>
            <Button onClick={exportData} fullWidth variant="primary">
              <Download />
              Скачать резервную копию
            </Button>
            <Field
              label="Восстановить из копии JSON"
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 20 * 1024 * 1024)
                    throw new Error("Копия больше 20 МБ");
                  setRestore(parseBackup(await file.text()));
                  setNotice("Копия проверена. Подтвердите восстановление.");
                } catch {
                  setRestore(null);
                  setNotice(
                    "Копия повреждена или имеет неподдерживаемый формат. Текущие данные сохранены.",
                  );
                }
              }}
            />
            {restore && (
              <Card>
                <h3>Копия проверена</h3>
                <p>
                  {restore.pets.length} питомцев:{" "}
                  {restore.pets.map((p) => p.name).join(", ")}
                </p>
                <p>
                  Восстановление заменит текущие данные всех питомцев. Сначала
                  скачайте текущую копию, если она нужна.
                </p>
                <Button
                  onClick={() =>
                    safe(async () => {
                      await commit(restore);
                      setStorageError("");
                      setRestore(null);
                      setScreen("day");
                      close();
                      setNotice("Данные восстановлены");
                    })
                  }
                  fullWidth
                  variant="destructive"
                >
                  Заменить данные этой копией
                </Button>
                <Button
                  onClick={() => setRestore(null)}
                  fullWidth
                  variant="secondary"
                >
                  Отмена
                </Button>
              </Card>
            )}
          </div>
        );
    }
  }
  return (
    <div className="app" aria-busy={busy}>
      <Toast message={notice} tone={/не удалось|ошибка|недоступ|прекращён/i.test(notice)
        ? "error" : notice.includes("Сохранено") ? "success" : "info"}/>
      <fieldset className="app-fields" disabled={busy}>
        {screen !== "account" && screen !== "profile" && <header className="app-header">
          <span className="brand">
            <PawPrint />
            рядом
          </span>
          <div className="app-header-actions">
            <div className="pet-switcher">
                <button type="button" className="pet-button btn btn-secondary"
                  aria-label={hasPets?"Выбрать питомца: "+pet.name:"Добавить питомца"}
                  aria-expanded={hasPets?petMenuOpen:undefined}
                  aria-haspopup={hasPets?"menu":undefined} onClick={openPetMenu}>
                  {hasPets?<><span className="avatar"><Dog/></span>
                    <span>{pet.name}</span><ChevronDown className="pet-switcher-chevron"/></>:
                    <><Plus aria-hidden="true"/><span>Добавить питомца</span></>}
                </button>
                {petMenuOpen&&hasPets&&<>
                  <button className="pet-switcher-dismiss" type="button"
                    aria-label="Закрыть список питомцев" onClick={()=>setPetMenuOpen(false)}/>
                  <div className="pet-switcher-menu" role="menu" aria-label="Выбор питомца">
                    {state.pets.map(p=><button type="button" role="menuitemradio"
                      aria-checked={p.id===state.selectedPet} key={p.id} onClick={()=>choose(p)}>
                      <Dog aria-hidden="true"/><span>{p.name}</span>
                      {p.id===state.selectedPet&&<span aria-hidden="true">✓</span>}
                    </button>)}
                    <button type="button" role="menuitem"
                      onClick={addPetChoice}>
                      <Plus aria-hidden="true"/> Добавить питомца
                    </button>
                  </div>
                </>}
            </div>
            <AccountTrigger
              onClick={openAccount}
              hasPendingRequests={state.pets.some(
                (p) => p.role === "owner" && (p.pendingRequests ?? 0) > 0
              )}
            />
          </div>
        </header>}
        {hasPets && pet.demo && (
          <div className="demo-banner">
            Демонстрационный питомец · все данные вымышлены
          </div>
        )}
        {storageError && (
          <div className="notice" role="alert">
            {storageError}
            <Button
              onClick={() => setOverlay({ kind: "backup" })}
              variant="ghost"
            >
              Открыть резервные копии
            </Button>
          </div>
        )}
        <main>
          {screen === "account" && <>
            <div className="account-back-row">
              <button type="button" className="account-back" onClick={leaveAccount}
                aria-label="Назад" title="Назад">
                <ArrowLeft aria-hidden="true" />
              </button>
            </div>
            {accountContent(state.pets)}
            <section className="account-section-shell account-pets-section">
              <SectionHeader title="Питомцы и доступ" />
              <Card className="account-pets-management">
              {state.pets.map(p=><div className="account-pet-row" key={p.id}>
                 <span><strong>{p.name}</strong><small>{p.role==="editor"?"Совместный доступ":"Владелец"}</small></span>
                 <Button size="sm" variant="secondary" aria-label={"Управлять питомцем "+p.name} onClick={()=>goToPetSettings(p)}>
                   <Settings aria-hidden="true"/> Управление
                 </Button>
               </div>)}
               {!hasPets&&<p className="hint">У вас пока нет питомцев.</p>}
               <Button variant="secondary" fullWidth onClick={addPetChoice}>
                 <Plus aria-hidden="true"/> Добавить питомца
               </Button>
              </Card>
            </section>
            <Button type="button" variant="ghost" className="account-logout" fullWidth
              loading={leavingAccount} loadingText="Выходим…"
              onClick={() => safe(async () => {
                if (leavingAccount) return;
                setLeavingAccount(true);
                try { await onLogout(); } finally { setLeavingAccount(false); }
              })}>
              <LogOut aria-hidden="true"/> Выйти из аккаунта
            </Button>
          </>}
          {!hasPets && screen !== "account" && screen !== "profile" && (
            <p className="no-pet-notice" role="status">
              Питомец не выбран. Разделы доступны для просмотра. Чтобы добавлять записи, сначала добавьте питомца.
            </p>
          )}
          {screen === "day" && (hasPets && showFirstPetSetup ? (
            <FirstPetSetup
              onSave={(details) => finishFirstPetSetup(details)}
              onSkip={() => finishFirstPetSetup()}
            />
          ) : (
            <Calendar
              pet={pet}
              selected={selected}
              month={month}
              setSelected={setSelected}
              setMonth={setMonth}
              readOnly={!hasPets}
              onAdd={() => { if (hasPets) setOverlay({ kind: "event" }); }}
              onTraining={(id) => {
                setOverlay({ kind: "trainingDetail", sessionId: id });
              }}
              onToggle={toggle}
              onDetail={(event, on) =>
                setOverlay({ kind: "detail", event, on })
              }
            />
          ))}{" "}
          {screen === "training" && (
            <Training
              session={session}
              openSession={openTraining}
              onOpened={() => setOpenTraining(undefined)}
              canEdit={hasPets && (pet.role === "owner" || pet.role === "editor")}
              noPet={!hasPets}
              key={hasPets ? pet.id : "no-pet"}
              pet={pet}
              onMonthVisible={async month=>{
                if(!pet.trainingSchedules?.some(sc=>sc.is_active))return;
                const changed=await rpc(session,"materialize_training_month",{
                  p_pet:pet.id,p_month:month+"-01",
                });
                if(changed)await refreshNow();
              }}
              onSave={(next) => update(() => next)}
            />
          )}{" "}
          {screen === "health" && (
            <Health
              pet={pet}
              readOnly={!hasPets}
              onWeight={() => setOverlay({ kind: "weight" })}
              onRecord={() => setOverlay({ kind: "record" })}
              onEditWeight={(entryId) => setOverlay({ kind: "editWeight", entryId })}
              onEditRecord={(entryId) => setOverlay({ kind: "editRecord", entryId })}
              onSummary={() => setOverlay({ kind: "summary" })}
              onPlan={(name, linkedRecord) =>
                setOverlay({
                  kind: "event",
                  category: "health",
                  name,
                  linkedRecord,
                })
              }
            />
          )}{" "}
          {hasPets && screen === "stock" && (
            <Stock
              pet={pet}
              session={session}
              initialItemId={stockTarget}
              onInitialItemHandled={() => setStockTarget(undefined)}
              onShop={() => setOverlay({ kind: "shopping" })}
              onPurchaseDone={async itemId => {
                await saved(() => update(p => completeShoppingItem(p,itemId,0,today())));
              }}
              onToggle={(itemId) => {
                const item = pet.shopping.find((s) => s.id === itemId);
                if (!item) return;
                if (!item.done) setOverlay({ kind: "finishShopping", itemId });
                else safe(() => update((p) => restoreShoppingItem(p, itemId)));
              }}
            />
          )}{" "}
          {!hasPets && screen === "stock" && (
            <div className="stock-screen stock-no-pet">
              <section className="stock-section">
                <div className="stock-list-header">
                  <h2>Запасы</h2>
                  <button type="button" className="stock-add-trigger" disabled
                    aria-label="Добавить запас или покупку">
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                <Card variant="info" className="stock-collection">
                  <p className="stock-muted">Запасов пока нет. Добавьте питомца, чтобы вести учёт.</p>
                </Card>
              </section>
              <section className="stock-section stock-shopping">
                <SectionHeader title="Купить">
                  <span className="stock-shopping-count">0 в списке</span>
                </SectionHeader>
                <Empty title="Всё есть дома">
                  Покупки можно добавлять после выбора питомца.
                </Empty>
              </section>
            </div>
          )}{" "}
          {hasPets && screen === "profile" && (
            <section className="pet-profile-screen">
              <div className="account-back-row">
                <button type="button" className="account-back" onClick={leavePetProfile}
                  aria-label="Назад" title="Назад"><ArrowLeft aria-hidden="true"/></button>
              </div>
              <div className="profile-hero">
                <span className="avatar">
                  <Dog />
                </span>
                <div>
                  <h1>{pet.name}</h1>
                  <p>{pet.breed || "Порода не указана"}</p>
                </div>
              </div>
              <Card>
                <dl>
                  <div>
                    <dt>Дата рождения</dt>
                    <dd>
                      {pet.birthday
                        ? fmt(pet.birthday, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "Не указана"}
                    </dd>
                  </div>
                  <div>
                    <dt>Пол</dt>
                    <dd>{pet.sex || "Не указан"}</dd>
                  </div>
                  <div>
                    <dt>Чип</dt>
                    <dd>{pet.chip || "Не указан"}</dd>
                  </div>
                </dl>
                <Button
                  onClick={() => setOverlay({ kind: "editpet" })}
                  fullWidth
                  variant="secondary"
                >
                  Редактировать профиль
                </Button>
              </Card>
              <section className="pet-profile-section">
                <SectionHeader title="Совместный доступ" />
                <Card className="pet-members-card">
                  <PetMembersSummary session={session} pet={pet} />
                  {pet.role === "owner" ? (
                    <Button fullWidth onClick={() => setOverlay({ kind: "sharing" })}>
                      Управлять доступом
                      {pet.pendingRequests ? ` · ${pet.pendingRequests}` : ""}
                    </Button>
                  ) : (
                    <Button fullWidth variant="ghost" onClick={() => setOverlay({ kind: "sharing" })}>
                      Покинуть питомца
                    </Button>
                  )}
                </Card>
              </section>
              <section className="pet-profile-section">
              <SectionHeader title="Документы">
                <Button
                  onClick={() => setOverlay({ kind: "document" })}
                  variant="ghost"
                >
                  Добавить
                </Button>
              </SectionHeader>
              {pet.documents.length ? (
                pet.documents.map((d) => (
                  <Card key={d.id}>
                    <h3>{d.name}</h3>
                    <p className="hint">{d.filename}</p>
                    <a
                      className="text-button"
                      href={d.data}
                      download={d.filename}
                    >
                      Скачать документ
                    </a>
                    <Button size="sm" variant="ghost"
                      onClick={() => setOverlay({ kind: "deleteDocument", entryId: d.id })}>
                      Удалить документ
                    </Button>
                  </Card>
                ))
              ) : (
                <Empty title="Документов пока нет">
                  Добавьте ветпаспорт или результаты обследований.
                </Empty>
              )}

              <Button
                onClick={() => setOverlay({ kind: "backup" })}
                fullWidth
                variant="secondary"
              >
                Резервные копии и восстановление
              </Button>
              {pet.role === "owner" && (
                <Button
                  onClick={() => setOverlay({ kind: "deletePet" })}
                  fullWidth
                  variant="destructive"
                  className="pet-profile-delete"
                >
                  Удалить питомца
                </Button>
              )}
              </section>
            </section>
          )}
        </main>
        {!showFirstPetSetup && screen !== "profile" && <nav className="bottom-nav" aria-label="Разделы приложения">
          {nav.map(([key, label, Icon]) => (
            <Button
              key={key}
              aria-current={screen === key ? "page" : undefined}
              onClick={() => {
                setScreen(key);
                setNotice("");
                window.scrollTo({ top: 0 });
              }}
              variant="ghost"
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </nav>}
        {overlay && (
          <Modal title={title} onClose={close}>
            {modalBody()}
          </Modal>
        )}
      </fieldset>
    </div>
  );
}
