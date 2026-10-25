/** Retired: invitations by email were removed from PET APP.
 * Cached older clients must receive a definitive stop response.
 */
Deno.serve((request: Request) => {
  const origin = request.headers.get("Origin");
  const allowed = origin === "https://pavelmashina.github.io" ||
    origin === "http://localhost:5173" ||
    origin === "http://127.0.0.1:5173";
  const headers = {
    ...(allowed && origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  return new Response(JSON.stringify({
    error: "Приглашения по email больше не поддерживаются. Добавьте питомца с помощью его ID.",
  }), { status: 410, headers });
});
