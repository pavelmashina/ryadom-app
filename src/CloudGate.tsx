import { useEffect, useRef, useState, type FormEvent } from "react";
import App from "./App";
import { getValidSession, signIn, signOut, signUp, type AuthSession } from "./backend";
import { loadAccount, saveAccount, type CloudSnapshot } from "./cloud-data";
import type { State } from "./domain";
export default function CloudGate() {
  const [phase,setPhase]=useState<"loading"|"auth"|"ready"|"error">("loading");
  const [mode,setMode]=useState<"login"|"register">("login");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [account,setAccount]=useState<{session:AuthSession;snapshot:CloudSnapshot}|null>(null);
  const active=useRef<AuthSession|null>(null), revision=useRef(0), generation=useRef(0),saving=useRef(false);
  async function activate(session:AuthSession,epoch:number) {
    const snapshot=await loadAccount(session);
    if(generation.current!==epoch)return;
    active.current=session;revision.current=snapshot.revision;
    setAccount({session,snapshot});setPhase("ready");
  }
  useEffect(()=>{
    let stopped=false;
    const epoch=++generation.current;
    getValidSession().then(s=>{if(stopped)return;if(s)return activate(s,epoch);setPhase("auth");})
      .catch(e=>{if(!stopped){setMessage(e instanceof Error?e.message:"Не удалось загрузить данные");setPhase("error");}});
    function changed(e:StorageEvent) {
      if(e.key==="ryadom:auth:v1") {
        ++generation.current;active.current=null;setAccount(null);setPhase("loading");
        location.reload();
      }
    }
    window.addEventListener("storage",changed);
    return ()=>{stopped=true;++generation.current;window.removeEventListener("storage",changed);};
  },[]);
  async function persist(next:State) {
    const s=active.current;
    if(!s)throw new Error("Войдите в аккаунт");
    if(saving.current)throw new Error("Дождитесь завершения сохранения");
    saving.current=true;setBusy(true);
    const epoch=generation.current;
    try {
      const saved=await saveAccount(s,next,revision.current);
      if(epoch!==generation.current)throw new Error("Аккаунт изменился. Войдите снова.");
      revision.current=saved.revision;return saved.state;
    } finally {saving.current=false;setBusy(false);}
  }
  async function logout() {
    if(saving.current)return;
    setBusy(true);++generation.current;
    const s=active.current;active.current=null;setAccount(null);setPhase("auth");setMessage("");
    try {await signOut(s);} catch {setMessage("Вы вышли на этом устройстве. Сервер недоступен.");}
    finally {setBusy(false);}
  }
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;
    const data=new FormData(e.currentTarget),email=String(data.get("email")??"").trim(),password=String(data.get("password")??"");
    setBusy(true);setMessage("");
    try {
      const result=mode==="register"?await signUp(email,password):{session:await signIn(email,password)};
      if(!result.session){setMode("login");setMessage("Подтвердите email по ссылке в письме, затем войдите.");return;}
      setPhase("loading");await activate(result.session,++generation.current);
    } catch(e){setMessage(e instanceof Error?e.message:"Не удалось войти");setPhase("auth");}
    finally{setBusy(false);}
  }
  if(phase==="loading")return <div className="cloud-screen"><div className="cloud-card" role="status">Загружаем ваши данные…</div></div>;
  if(phase==="error")return <div className="cloud-screen"><div className="cloud-card"><h1>Не удалось загрузить данные</h1><p role="alert">{message}</p><button className="primary" onClick={()=>location.reload()}>Повторить</button><button onClick={logout}>Выйти</button></div></div>;
  if(phase==="auth")return <div className="cloud-screen"><form className="cloud-card" onSubmit={submit}><span className="cloud-logo">🐾</span><h1>{mode==="login"?"Войти в Рядом":"Создать аккаунт"}</h1><p>Ваши питомцы и занятия — только в вашем аккаунте.</p>
    <label>Email<input name="email" type="email" required autoComplete="email" disabled={busy}/></label>
    <label>Пароль<input name="password" type="password" required minLength={mode==="register"?8:1} autoComplete={mode==="register"?"new-password":"current-password"} disabled={busy}/></label>
    {message && <p className="cloud-message" role="alert">{message}</p>}
    <button className="primary" disabled={busy}>{busy?"Подождите…":mode==="login"?"Войти":"Зарегистрироваться"}</button>
    <button type="button" className="text-button" disabled={busy} onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("");}}>{mode==="login"?"Нет аккаунта? Зарегистрироваться":"Уже есть аккаунт? Войти"}</button>
  </form></div>;
  if(!account)return null;
  return <><div className="cloud-account"><span>{account.session.user.email}</span><button onClick={logout} disabled={busy}>Выйти</button></div><App key={account.session.user.id} initial={account.snapshot.state} onPersist={persist}/></>;
}
