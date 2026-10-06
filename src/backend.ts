const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "");
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

const AUTH_STORAGE_KEY = "ryadom:auth:v1";

type AuthUser = {
  id: string;
  email?: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
};

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: AuthUser;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  code?: string;
};

function configured() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase не настроен");
  }
  return { supabaseUrl, publishableKey };
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as AuthResponse;
    if (body.code === "same_password") return "Новый пароль должен отличаться от прежнего.";
    if (body.code === "weak_password") return "Выберите более надёжный пароль: минимум 8 символов, буквы и цифры.";
    if (body.code === "email_address_not_authorized") return "Отправка писем пока недоступна для этого адреса. Обратитесь к владельцу приложения.";
    if (body.code === "PT409" || body.code === "40001") return "Данные изменились на другом устройстве. Обновите страницу перед сохранением.";
    if (body.code === "23505") return "Такая команда или запись уже существует.";
    if (response.status === 401) return "Сессия истекла или неверный email / пароль. Войдите снова.";
    if (response.status === 429) return "Слишком много попыток. Подождите и повторите.";
    return body.message || body.error_description || body.msg || body.error || `Ошибка ${response.status}`;
  } catch {
    return `Ошибка ${response.status}`;
  }
}

function toSession(body: AuthResponse): AuthSession | null {
  if (!body.access_token || !body.refresh_token || !body.user?.id) return null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Math.max(30, body.expires_in || 3600) * 1000,
    user: body.user,
  };
}

export function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      !parsed.accessToken ||
      !parsed.refreshToken ||
      !parsed.expiresAt ||
      !parsed.user?.id
    ) {
      return null;
    }
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

function storeSession(session: AuthSession | null) {
  if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function signIn(email: string, password: string) {
  const { supabaseUrl, publishableKey } = configured();
  const response = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const session = toSession((await response.json()) as AuthResponse);
  if (!session) throw new Error("Supabase не вернул сессию");
  storeSession(session);
  return session;
}

export async function signUp(email: string, password: string) {
  const { supabaseUrl, publishableKey } = configured();
  const response = await request(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as AuthResponse;
  const session = toSession(body);
  if (session) storeSession(session);
  return { session, needsEmailConfirmation: !session };
}

async function performRefresh(session: AuthSession) {
  const { supabaseUrl, publishableKey } = configured();
  const response = await request(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) {
    if (readStoredSession()?.refreshToken === session.refreshToken) storeSession(null);
    return null;
  }
  const next = toSession((await response.json()) as AuthResponse);
  if (readStoredSession()?.user.id !== session.user.id) throw new Error("Аккаунт изменился");
  if (!next) {
    storeSession(null);
    return null;
  }
  storeSession(next);
  return next;
}

let refreshing: Promise<AuthSession | null> | null = null;
export function refreshSession(session: AuthSession) {
  if (!refreshing) refreshing=performRefresh(session).finally(()=>{refreshing=null;});
  return refreshing;
}
export async function getValidSession() {
  const session = readStoredSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  return refreshSession(session);
}

export async function signOut(session: AuthSession | null) {
  try {
    if (session) {
      const { supabaseUrl, publishableKey } = configured();
      await request(`${supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    }
  } finally {
    if (session && readStoredSession()?.user.id === session.user.id) storeSession(null);
  }
}

async function authorizedSession(session: AuthSession) {
  const stored=readStoredSession();
  if(stored?.user.id!==session.user.id) throw new Error("Аккаунт изменился. Войдите снова.");
  if (stored.expiresAt > Date.now() + 60_000) return stored;
  const refreshed = await refreshSession(session);
  if (!refreshed) throw new Error("Сессия истекла. Войдите снова.");
  return refreshed;
}


async function request(url:string,options:RequestInit) {
  try {return await fetch(url,{...options,signal:AbortSignal.timeout(25000)});}
  catch {throw new Error("Нет связи с сервером. Проверьте интернет и повторите. Данные не сохранены.");}
}
export async function rpc(session:AuthSession,name:string,body:Record<string,unknown>):Promise<unknown> {
  const current=await authorizedSession(session);
  const {supabaseUrl,publishableKey}=configured();
  const response=await request(supabaseUrl+"/rest/v1/rpc/"+name,{
    method:"POST",cache:"no-store",
    headers:{apikey:publishableKey,Authorization:"Bearer "+current.accessToken,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(await parseError(response));
  return response.json();
}

const RECOVERY_KEY = "ryadom:recovery:v1";
const RECOVERY_EXPIRED = "Ссылка недействительна или устарела. Запросите новое письмо.";
export function clearRecovery() { sessionStorage.removeItem(RECOVERY_KEY); }

export async function requestPasswordReset(email: string) {
  const { supabaseUrl, publishableKey } = configured();
  const redirect = new URL(import.meta.env.BASE_URL, location.origin).href;
  const response = await request(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

// Recovery is scoped to this tab and never replaces another account's login.
export async function readRecoverySession(): Promise<AuthSession | null> {
  const params = new URLSearchParams(location.hash.slice(1));
  let candidate: Partial<AuthSession> | null = null;
  if (params.has("error") || params.get("type") === "recovery") {
    history.replaceState(null, "", location.pathname + location.search);
    clearRecovery();
    if (params.has("error")) throw new Error(RECOVERY_EXPIRED);
    const seconds = Number(params.get("expires_in"));
    const absolute = Number(params.get("expires_at"));
    candidate = { accessToken: params.get("access_token") || "", refreshToken: params.get("refresh_token") || "",
      expiresAt: absolute > 0 ? absolute * 1000 : Date.now() + Math.min(seconds, 3600) * 1000 };
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(candidate));
  } else {
    const saved = sessionStorage.getItem(RECOVERY_KEY);
    if (!saved) return null;
    try { candidate = JSON.parse(saved) as Partial<AuthSession>; }
    catch { clearRecovery(); throw new Error(RECOVERY_EXPIRED); }
  }
  if (!candidate?.accessToken || !candidate.refreshToken || !candidate.expiresAt || candidate.expiresAt <= Date.now()) {
    clearRecovery(); throw new Error(RECOVERY_EXPIRED);
  }
  const { supabaseUrl, publishableKey } = configured();
  const response = await request(`${supabaseUrl}/auth/v1/user`, {
    method: "GET", headers: { apikey: publishableKey, Authorization: `Bearer ${candidate.accessToken}` },
  });
  if (!response.ok) { clearRecovery(); throw new Error(RECOVERY_EXPIRED); }
  const user = await response.json() as AuthUser;
  if (!user.id) { clearRecovery(); throw new Error(RECOVERY_EXPIRED); }
  return { accessToken: candidate.accessToken, refreshToken: candidate.refreshToken, expiresAt: candidate.expiresAt, user };
}

export async function resetPassword(session: AuthSession, password: string, confirmation: string) {
  if (password.length < 8) throw new Error("Пароль должен содержать минимум 8 символов.");
  if (password !== confirmation) throw new Error("Пароли не совпадают.");
  if (session.expiresAt <= Date.now()) { clearRecovery(); throw new Error(RECOVERY_EXPIRED); }
  const { supabaseUrl, publishableKey } = configured();
  const response = await request(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT", headers: { apikey: publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  clearRecovery();
  // Updating the password succeeded even if revoking the temporary session fails.
  try { await signOut(session); } catch { /* Session expires normally if offline. */ }
}
