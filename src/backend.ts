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
    return body.error_description || body.msg || body.error || `Ошибка ${response.status}`;
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
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
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
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
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

export async function refreshSession(session: AuthSession) {
  const { supabaseUrl, publishableKey } = configured();
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) {
    storeSession(null);
    return null;
  }
  const next = toSession((await response.json()) as AuthResponse);
  if (!next) {
    storeSession(null);
    return null;
  }
  storeSession(next);
  return next;
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
      await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    }
  } finally {
    storeSession(null);
  }
}

async function authorizedSession(session: AuthSession) {
  if (session.expiresAt > Date.now() + 60_000) return session;
  const refreshed = await refreshSession(session);
  if (!refreshed) throw new Error("Сессия истекла. Войдите снова.");
  return refreshed;
}

export async function loadCloudState(session: AuthSession) {
  const current = await authorizedSession(session);
  const { supabaseUrl, publishableKey } = configured();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_state?select=state,updated_at&user_id=eq.${encodeURIComponent(current.user.id)}&limit=1`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${current.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(await parseError(response));
  const rows = (await response.json()) as Array<{ state: unknown; updated_at: string }>;
  return rows[0] || null;
}

export async function saveCloudState(session: AuthSession, state: unknown) {
  const current = await authorizedSession(session);
  const { supabaseUrl, publishableKey } = configured();
  const response = await fetch(`${supabaseUrl}/rest/v1/user_state?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${current.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: current.user.id,
      state,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return current;
}
