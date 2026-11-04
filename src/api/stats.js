// GET /api/stats?days=30&topic=<slug> — aggregated numbers for the dashboard. Requires DASHBOARD_TOKEN.
// topic omitted or "" = all topics. Rows recorded before topics existed count as premier-league.
import { authorised, json, topicParam } from "./_auth.js";

const T = (alias = "") => `(?2 = '' OR COALESCE(${alias}topic, 'premier-league') = ?2)`;

export async function onRequestGet({ request, env }) {
  if (!authorised(request, env)) return json({ error: "Unauthorised" }, 401);
  const days = Math.max(1, Math.min(365, +new URL(request.url).searchParams.get("days") || 30));
  const topic = topicParam(request);
  const since = Date.now() - days * 86400000;
  const db = env.DB;
  const all = (sql) => db.prepare(sql).bind(since, topic).all().then((r) => r.results);

  const [totals, daily, reach, stages, sets, wrongPicks, sessions, players, byTopic] = await Promise.all([
    all(`SELECT
           (SELECT COUNT(DISTINCT player_id) FROM sessions WHERE started_at >= ?1 AND ${T()}) AS players,
           (SELECT COUNT(*) FROM sessions WHERE started_at >= ?1 AND ${T()}) AS sessions,
           (SELECT COUNT(*) FROM attempts WHERE ts >= ?1 AND ${T()}) AS picks,
           (SELECT COUNT(*) FROM attempts WHERE ts >= ?1 AND ${T()} AND correct = 0) AS fails,
           (SELECT AVG(ms) FROM attempts WHERE ts >= ?1 AND ${T()} AND correct = 1) AS avg_solve_ms,
           (SELECT AVG(furthest) FROM sessions WHERE started_at >= ?1 AND ${T()} AND furthest > 0) AS avg_furthest,
           (SELECT AVG(CASE WHEN correct = 1 THEN 1.0 ELSE 0 END) FROM attempts WHERE ts >= ?1 AND ${T()} AND attempt_no = 1) AS first_try_rate`),
    all(`SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS sessions, COUNT(DISTINCT player_id) AS players
         FROM sessions WHERE started_at >= ?1 AND ${T()} GROUP BY day ORDER BY day`),
    all(`SELECT furthest, COUNT(*) AS n FROM sessions WHERE started_at >= ?1 AND ${T()} AND furthest > 0 GROUP BY furthest ORDER BY furthest`),
    all(`SELECT d,
           SUM(CASE WHEN attempt_no = 1 THEN 1 ELSE 0 END) AS shown,
           AVG(CASE WHEN attempt_no = 1 THEN correct * 1.0 END) AS first_try_rate,
           AVG(CASE WHEN correct = 1 THEN ms END) AS avg_solve_ms,
           SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS fails
         FROM attempts WHERE ts >= ?1 AND ${T()} GROUP BY d ORDER BY d`),
    all(`SELECT COALESCE(topic, 'premier-league') AS topic, set_id, MAX(d) AS d,
           SUM(CASE WHEN attempt_no = 1 THEN 1 ELSE 0 END) AS shown,
           AVG(CASE WHEN attempt_no = 1 THEN correct * 1.0 END) AS first_try_rate,
           AVG(CASE WHEN correct = 1 THEN ms END) AS avg_solve_ms,
           SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS fails
         FROM attempts WHERE ts >= ?1 AND ${T()} GROUP BY 1, set_id`),
    all(`SELECT COALESCE(topic, 'premier-league') AS topic, set_id, chosen, COUNT(*) AS n
         FROM attempts WHERE ts >= ?1 AND ${T()} AND correct = 0 GROUP BY 1, set_id, chosen`),
    all(`SELECT s.id, s.nickname, COALESCE(s.topic, 'premier-league') AS topic, s.country, s.device, s.started_at, s.last_at, s.ended_at, s.end_reason,
                s.furthest, s.score, s.fails, s.lives_left,
                (SELECT AVG(ms) FROM attempts a WHERE a.session_id = s.id AND a.correct = 1) AS avg_solve_ms
         FROM sessions s WHERE s.started_at >= ?1 AND ${T("s.")} ORDER BY s.started_at DESC LIMIT 200`),
    all(`SELECT p.id, p.nickname, p.country, p.first_seen, p.last_seen,
                COUNT(s.id) AS sessions, MAX(s.score) AS best, SUM(s.fails) AS fails
         FROM players p JOIN sessions s ON s.player_id = p.id
         WHERE s.started_at >= ?1 AND ${T("s.")} GROUP BY p.id ORDER BY sessions DESC, best DESC LIMIT 100`),
    all(`SELECT COALESCE(topic, 'premier-league') AS topic, COUNT(*) AS sessions, COUNT(DISTINCT player_id) AS players
         FROM sessions WHERE started_at >= ?1 AND ?2 = ?2 GROUP BY 1`),
  ]);

  // keep the most-picked wrong answer per set
  const key = (r) => r.topic + ":" + r.set_id;
  const topWrong = {};
  for (const w of wrongPicks) if (!topWrong[key(w)] || w.n > topWrong[key(w)].n) topWrong[key(w)] = w;
  for (const s of sets) { const w = topWrong[key(s)]; s.top_wrong = w ? { name: w.chosen, n: w.n } : null; }

  return json({ generated_at: Date.now(), days, topic, totals: totals[0], daily, reach, stages, sets, sessions, players, by_topic: byTopic });
}
