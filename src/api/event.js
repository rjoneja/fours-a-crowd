// POST /api/event  — receives gameplay events from the game and writes them to D1.
// Public endpoint: validate everything, never trust the client for more than the event itself.

const TYPES = new Set(["session_start", "question_shown", "answer", "session_end"]);
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
const int = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : null);
const idOk = (v) => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);

function device(ua = "") {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response("DB binding missing", { status: 500 });
  const len = +(request.headers.get("content-length") || 0);
  if (len > 4096) return new Response("Too large", { status: 413 });

  let e;
  try { e = JSON.parse(await request.text()); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (!e || !TYPES.has(e.type) || !idOk(e.player_id) || !idOk(e.session_id)) return new Response("Bad event", { status: 400 });

  const now = Date.now();
  const country = request.cf?.country || null;
  const nickname = clip(e.nickname, 24);
  const db = env.DB;

  try {
    if (e.type === "session_start") {
      await db.batch([
        db.prepare(`INSERT INTO players (id, nickname, country, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
                    ON CONFLICT(id) DO UPDATE SET nickname = COALESCE(?2, nickname), country = COALESCE(?3, country), last_seen = ?4`)
          .bind(e.player_id, nickname, country, now),
        db.prepare(`INSERT OR IGNORE INTO sessions (id, player_id, nickname, country, device, tz, started_at, last_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
          .bind(e.session_id, e.player_id, nickname, country, device(request.headers.get("user-agent") || ""), clip(e.tz, 64), now),
      ]);
    } else if (e.type === "answer") {
      const correct = e.correct ? 1 : 0;
      const qi = int(e.q_index, 0, 10000) ?? 0;
      const lives = int(e.lives_left, 0, 3);
      await db.batch([
        db.prepare(`INSERT INTO attempts (session_id, player_id, set_id, d, q_index, attempt_no, correct, ms, chosen, lives_left, ts, names_hidden)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
          .bind(e.session_id, e.player_id, int(e.set_id, 0, 100000), int(e.d, 0, 10), qi, int(e.attempt_no, 1, 10),
                correct, int(e.ms, 0, 3600000), clip(e.chosen, 80), lives, now, int(e.names_hidden, 0, 4) ?? 0),
        db.prepare(`UPDATE sessions SET last_at = ?2, furthest = MAX(furthest, ?3),
                      score = score + ?4, fails = fails + ?5, lives_left = COALESCE(?6, lives_left) WHERE id = ?1`)
          .bind(e.session_id, now, qi + 1, correct, correct ? 0 : 1, lives),
        db.prepare(`UPDATE players SET last_seen = ?2 WHERE id = ?1`).bind(e.player_id, now),
      ]);
    } else if (e.type === "session_end") {
      await db.prepare(`UPDATE sessions SET ended_at = COALESCE(ended_at, ?2), last_at = ?2, end_reason = COALESCE(end_reason, ?3) WHERE id = ?1`)
        .bind(e.session_id, now, clip(e.reason, 20)).run();
    } else {
      // question_shown: only refresh activity; the attempts table carries the timing.
      await db.prepare(`UPDATE sessions SET last_at = ?2, furthest = MAX(furthest, ?3) WHERE id = ?1`)
        .bind(e.session_id, now, (int(e.q_index, 0, 10000) ?? 0) + 1).run();
    }
  } catch (err) {
    return new Response("Write failed", { status: 500 });
  }
  return new Response(null, { status: 204 });
}

