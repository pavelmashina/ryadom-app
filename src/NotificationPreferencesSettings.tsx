import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AuthSession } from "./backend";
import { getNotificationPreferences, updateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "./push-api";

type Choices = Omit<NotificationPreferences, "user_id">;
type Category = "trainings_enabled" | "events_enabled" | "reminders_enabled";
type FilterKey = "trainings_pet_ids" | "events_pet_ids" | "reminders_pet_ids";
type PetChoice = { id: string; name: string };
const sections: { key: Category; label: string; filter: FilterKey }[] = [
  { key: "trainings_enabled", label: "О тренировках", filter: "trainings_pet_ids" },
  { key: "events_enabled", label: "О событиях", filter: "events_pet_ids" },
  { key: "reminders_enabled", label: "Напоминания", filter: "reminders_pet_ids" },
];
/** Changes are persisted on the account and enforced again by server-side dispatch. */
export default function NotificationPreferencesSettings({
  session, disabled = false, pets = [],
}: {
  session: AuthSession;
  disabled?: boolean;
  pets?: PetChoice[];
}) {
  const [prefs,setPrefs] = useState<Choices>({...DEFAULT_NOTIFICATION_PREFERENCES});
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  useEffect(()=>{
    let active=true;
    setLoading(true);
    setError("");
    void getNotificationPreferences(session).then(({user_id: _uid,...next})=>{
      if(active)setPrefs(next);
    }).catch((e)=>{
      if(active)setError(e instanceof Error?e.message:"Не удалось загрузить настройки уведомлений");
    }).finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[session.user.id]);
  async function save(next:Choices){
    if(busy||loading||disabled)return;
    setBusy(true);setError("");setNotice("");
    const previous=prefs;
    setPrefs(next);
    try{
      await updateNotificationPreferences(session,next);
      setNotice("Настройки уведомлений сохранены");
    }catch(e){
      setPrefs(previous);
      setError(e instanceof Error?e.message:"Не удалось сохранить настройки уведомлений");
    }finally{setBusy(false)}
  }
  function setPetSelection(key: FilterKey, id: string, checked: boolean) {
    const current = prefs[key];
    const selected = current === null ? pets.map(p=>p.id) : current;
    const next = checked ? [...new Set([...selected,id])] : selected.filter(x=>x!==id);
    // Re-selecting every pet switches back to the automatic All option.
    void save({...prefs,[key]:pets.length > 0 && pets.every(p=>next.includes(p.id)) ? null : next});
  }
  return <div className="notification-preferences" aria-busy={busy||loading}
    aria-disabled={disabled}>
    {sections.map(({key,label,filter})=>{
      const selection=prefs[filter] ?? null;
      const shown=pets.filter(p=>selection===null||selection.includes(p.id));
      const choiceLabel=selection===null ? "Все питомцы"
        : shown.length===0 ? "Ни одного питомца"
        : shown.length===pets.length ? "Все питомцы" : shown.map(p=>p.name).join(", ");
      return <div className="notification-category" key={key}>
        <label className="notification-toggle-row">
          <span>{label}</span>
          <input type="checkbox" role="switch" aria-label={label}
            checked={prefs[key]} disabled={disabled||busy||loading}
            onChange={event=>void save({...prefs,[key]:event.target.checked})}/>
        </label>
        {prefs[key]&&<details className="notification-pet-filter">
          <summary><span className="notification-pet-filter-summary">{choiceLabel}</span>
            <ChevronDown aria-hidden="true" /></summary>
          <div className="notification-pet-filter-options">
            <label className="notification-pet-option">
              <input type="checkbox" checked={selection===null}
                disabled={disabled||busy||loading}
                onChange={()=>void save({...prefs,[filter]:null})}/>
              Все питомцы
            </label>
            {pets.map(p=><label key={p.id} className="notification-pet-option">
              <input type="checkbox" checked={selection===null||selection.includes(p.id)}
                disabled={disabled||busy||loading}
                onChange={event=>setPetSelection(filter,p.id,event.target.checked)}/>
              {p.name}
            </label>)}
            {!pets.length&&<p className="hint">Добавьте питомца, чтобы выбрать уведомления.</p>}
          </div>
        </details>}
      </div>;
    })}
    {loading&&<p className="hint" role="status">Загружаем настройки…</p>}
    {notice&&<p className="hint" role="status">{notice}</p>}
    {error&&<p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
