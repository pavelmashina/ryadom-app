import { useEffect, useState } from "react";
import type { AuthSession } from "./backend";
import { getNotificationPreferences, updateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "./push-api";

type Choices = Omit<NotificationPreferences, "user_id">;
const offsets = [
  [0,"В момент тренировки"],
  [10,"За 10 минут"],
  [30,"За 30 минут"],
  [60,"За 1 час"],
  [180,"За 3 часа"],
  [1440,"За 1 день"],
  [10080,"За 1 неделю"],
] as const;

/** Preferences are per account and gate dispatch even if another pet member
 * configured the underlying event reminder. Device subscription is separate. */
export default function NotificationPreferencesSettings({ session }: { session: AuthSession }) {
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
    if(busy||loading)return;
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
  return <div className="notification-preferences" aria-busy={busy||loading}>
    {([
      ["trainings_enabled","О тренировках"],
      ["events_enabled","О событиях"],
      ["reminders_enabled","Напоминания"],
    ] as const).map(([key,label])=>
      <label className="notification-toggle-row" key={key}>
        <span>{label}</span>
        <input type="checkbox" role="switch" aria-label={label}
          checked={prefs[key]} disabled={busy||loading}
          onChange={event=>void save({...prefs,[key]:event.target.checked})}/>
      </label>)}
    {prefs.trainings_enabled&&<label className="notification-training-offset">
      <span>Напомнить о тренировке</span>
      <select value={prefs.training_offset_minutes} disabled={busy||loading}
        onChange={event=>void save({...prefs,training_offset_minutes:Number(event.target.value)})}>
        {offsets.map(([offset,label])=><option key={offset} value={offset}>{label}</option>)}
      </select>
    </label>}
    {loading&&<p className="hint" role="status">Загружаем настройки…</p>}
    {notice&&<p className="hint" role="status">{notice}</p>}
    {error&&<p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
