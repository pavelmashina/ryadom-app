const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "");
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && publishableKey);
}

export async function checkSupabaseConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, error: "Supabase не настроен" };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/app_health?select=status&id=eq.database&limit=1`,
      {
        headers: {
          apikey: publishableKey,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `Supabase вернул ${response.status}`,
      };
    }

    const rows = (await response.json()) as Array<{ status?: string }>;
    return rows[0]?.status === "ok"
      ? { ok: true }
      : { ok: false, error: "Supabase health-check не вернул status=ok" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Ошибка соединения с Supabase",
    };
  }
}
