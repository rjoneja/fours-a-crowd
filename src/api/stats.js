// GET /api/stats?days=30 — aggregated numbers for the dashboard. Requires DASHBOARD_TOKEN.
import { authorised, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!authorised(request, env)) return json({ error: "Unauthorised" }, 401);
  const days = Math.max(1, Math.min(365, +new URL(request.url).searchParams.get("days") || 30));
  const since = Date.now() - days * 86400000;
  const db = env.DB;
  const all = (sql, ...b) => db.prepare(sql).bind(...b).all().then((r) => r.results);

  const [totals, daily, reach, stages, sets, wrongPicks, sessions, players] = await Promise.all([
    all(`SELECT
           (SELECT COUNT(DISTINCT player_id) FROM sessions WHERE started_at >= ?1) AS players,
           (SELECT COUNT(*) FROM sessions WHERE started_at >= ?1) AS sessions,
           (SELECT COUNT(*) FROM attempts WHERE ts >= ?1) AS picks,
           (SELECT COUNT(*) FROM attempts WHERE ts >= ?1 AND correct = 0) AS fails,
           (SELECT AVG(ms) FROM attempts WHERE ts >= ?1 AND correct = 1) AS avg_solve_ms,
           (SELECT AVG(furthest) FROM sessions WHERE started_at >= ?1 AND furthest > 0) AS avg_furthest,
           (SELECT AVG(CASE WHEN correct = 1 THEN 1.0 ELSE 0 END) FROM attempts WHERE ts >= ?1 AND attempt_no = 1) AS first_try_rate`, since),
    all(`SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS sessions, COUNT(DISTINCT player_id) AS players
         FROM sessions WHERE started_at >= ?1 GROUP BY day ORDER BY day`, since),
    all(`SELECT furthest, COUNT(*) AS n FROM sessions WHERE started_at >= ?1 AND furthest > 0 GROUP BY furthest ORDER BY furthest`, since),
    all(`SELECT d,
           SUM(CASE WHEN attempt_no = 1 THEN 1 ELSE 0 END) AS shown,
           AVG(CASE WHEN attempt_no = 1 THEN correct * 1.0 END) AS first_try_rate,
           AVG(CASE WHEN correct = 1 THEN ms END) AS avg_solve_ms,
           SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS fails
         FROM attempts WHERE ts >= ?1 GROUP BY d ORDER BY d`, since),
    all(`SELECT set_id, MAX(d) AS d,
           SUM(CASE WHEN attempt_no = 1 THEN 1 ELSE 0 END) AS shown,
           AVG(CASE WHEN attempt_no = 1 THEN correct * 1.0 END) AS first_try_rate,
           AVG(CASE WHEN correct = 1 THEN ms END) AS avg_solve_ms,
           SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS fails
         FROM attempts WHERE ts >= ?1 GROUP BY set_id`, since),
    all(`SELECT set_id, chosen, COUNT(*) AS n FROM attempts WHERE ts >= ?1 AND correct = 0 GROUP BY set_id, chosen`, since),
    all(`SELECT s.id, s.nickname, s.country, s.device, s.started_at, s.last_at, s.ended_at, s.end_reason,
                s.furthest, s.score, s.fails, s.lives_left,
                (SELECT AVG(ms) FROM attempts a WHERE a.session_id = s.id AND a.correct = 1) AS avg_solve_ms
         FROM sessions s WHERE s.started_at >= ?1 ORDER BY s.started_at DESC LIMIT 200`, since),
    all(`SELECT p.id, p.nickname, p.country, p.first_seen, p.last_seen,
                COUNT(s.id) AS sessions, MAX(s.score) AS best, SUM(s.fails) AS fails
         FROM players p JOIN sessions s ON s.player_id = p.id
         WHERE s.started_at >= ?1 GROUP BY p.id ORDER BY sessions DESC, best DESC LIMIT 100`, since),
  ]);

  // keep the most-picked wrong answer per set
  const topWrong = {};
  for (const w of wrongPicks) if (!topWrong[w.set_id] || w.n > topWrong[w.set_id].n) topWrong[w.set_id] = w;
  for (const s of sets) s.top_wrong = topWrong[s.set_id] ? { name: topWrong[s.set_id].chosen, n: topWrong[s.set_id].n } : null;

  return json({ generated_at: Date.now(), days, totals: totals[0], daily, reach, stages, sets, sessions, players });
}
