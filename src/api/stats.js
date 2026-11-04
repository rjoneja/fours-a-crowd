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

  const stale = Date.now() - 30 * 60000; // a go with no end event and no activity for 30 minutes counts as left
  const [totals, daily, reach, stages, sets, wrongPicks, sessions, players, byTopic, positions, quits] = await Promise.all([
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
           COUNT(*) AS picks,
           AVG(CASE WHEN attempt_no = 1 THEN correct * 1.0 END) AS first_try_rate,
           AVG(CASE WHEN correct = 1 THEN ms END) AS avg_solve_ms,
           AVG(CASE WHEN attempt_no = 1 THEN ms END) AS avg_first_pick_ms,
           AVG(CASE WHEN attempt_no = 1 AND blurs IS NOT NULL THEN (blurs > 0) * 1.0 END) AS away_rate,
           AVG(CASE WHEN attempt_no = 1 THEN (ms > 60000) * 1.0 END) AS slow_rate,
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
    // Quadrant pressed vs quadrant holding the answer
    all(`SELECT odd_pos, pos, (attempt_no = 1) AS first, COUNT(*) AS n, SUM(correct) AS ok
         FROM attempts WHERE ts >= ?1 AND ${T()} AND pos IS NOT NULL GROUP BY 1, 2, 3`),
    // Where people left: the set on screen, and whether mid-question or on the answer pop-up
    db.prepare(`SELECT COALESCE(topic, 'premier-league') AS topic, last_set_id AS set_id, COALESCE(end_phase, 'unknown') AS phase, COUNT(*) AS n
         FROM sessions WHERE started_at >= ?1 AND (?2 = '' OR COALESCE(topic, 'premier-league') = ?2) AND last_set_id IS NOT NULL
           AND (end_reason = 'left' OR (end_reason IS NULL AND last_at < ?3))
         GROUP BY 1, 2, 3`).bind(since, topic, stale).all().then((r) => r.results),
  ]);

  // keep the most-picked wrong answer per set
  const key = (r) => r.topic + ":" + r.set_id;
  const topWrong = {};
  for (const w of wrongPicks) if (!topWrong[key(w)] || w.n > topWrong[key(w)].n) topWrong[key(w)] = w;
  for (const s of sets) { const w = topWrong[key(s)]; s.top_wrong = w ? { name: w.chosen, n: w.n } : null; }

  const quitBy = {};
  for (const q of quits) { const k = key(q); quitBy[k] = quitBy[k] || { question: 0, verdict: 0, other: 0 }; quitBy[k][q.phase === "question" || q.phase === "verdict" ? q.phase : "other"] += q.n; }
  // A set someone left on before answering has no attempts yet; give it a row so the quit isn't lost.
  const have = new Set(sets.map(key));
  for (const q of quits) if (!have.has(key(q))) { have.add(key(q)); sets.push({ topic: q.topic, set_id: q.set_id, d: null, shown: 0, picks: 0, fails: 0, top_wrong: null }); }
  for (const s of sets) {
    const q = quitBy[key(s)] || { question: 0, verdict: 0, other: 0 };
    s.quits = q.question + q.verdict + q.other; s.quits_question = q.question; s.quits_verdict = q.verdict;
    s.views = (s.shown || 0) + q.question;   // times the set was put in front of someone
  }

  return json({ generated_at: Date.now(), days, topic, totals: totals[0], daily, reach, stages, sets, sessions, players, by_topic: byTopic, positions, quits });
}
