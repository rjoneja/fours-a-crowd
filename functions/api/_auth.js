// Shared check for dashboard endpoints. Set DASHBOARD_TOKEN as a Pages secret.
// For stronger protection, also put /dashboard* and /api/stats* behind Cloudflare Access.
export function authorised(request, env) {
  const want = env.DASHBOARD_TOKEN;
  if (!want) return false;
  const h = request.headers.get("authorization") || "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : new URL(request.url).searchParams.get("token") || "";
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
