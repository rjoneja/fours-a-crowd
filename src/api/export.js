// GET /api/export — every pick as CSV, one row per attempt, with session context.
// This is the feature table for a future XGBoost difficulty model. Requires DASHBOARD_TOKEN.
import { authorised, topicParam } from "./_auth.js";

const COLS = ["attempt_id", "ts", "session_id", "player_id", "topic", "set_id", "d", "q_index", "attempt_no", "correct", "ms",
  "lives_left", "names_hidden", "chosen", "country", "device", "player_sessions_before", "player_prior_accuracy"];

const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export async function onRequestGet({ request, env }) {
  if (!authorised(request, env)) return new Response("Unauthorised", { status: 401 });
  const { results } = await env.DB.prepare(`
    SELECT a.id AS attempt_id, a.ts, a.session_id, a.player_id, COALESCE(a.topic, 'premier-league') AS topic, a.set_id, a.d, a.q_index, a.attempt_no, a.correct, a.ms,
           a.lives_left, a.names_hidden, a.chosen, s.country, s.device,
           (SELECT COUNT(*) FROM sessions s2 WHERE s2.player_id = a.player_id AND s2.started_at < s.started_at) AS player_sessions_before,
           (SELECT AVG(correct * 1.0) FROM attempts a2 WHERE a2.player_id = a.player_id AND a2.ts < a.ts) AS player_prior_accuracy
    FROM attempts a JOIN sessions s ON s.id = a.session_id
    WHERE (?1 = '' OR COALESCE(a.topic, 'premier-league') = ?1)
    ORDER BY a.ts LIMIT 200000`).bind(topicParam(request)).all();
  const body = [COLS.join(","), ...results.map((r) => COLS.map((c) => esc(r[c])).join(","))].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fours-a-crowd-attempts.csv"`, "cache-control": "no-store" },
  });
}
