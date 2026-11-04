// Fails the build if any topic's sets are malformed: node tools/validate-sets.mjs
import { readFileSync } from "node:fs";
const DATA = new URL("../public/data/", import.meta.url);
const { topics, default: def } = JSON.parse(readFileSync(new URL("topics.json", DATA)));
const errors = [];
if (!topics.some((t) => t.slug === def)) errors.push(`topics.json: default "${def}" isn't a topic`);
for (const t of topics) {
  if (!/^[a-z0-9-]{1,40}$/.test(t.slug)) errors.push(`topic slug "${t.slug}" must be lowercase letters, digits and hyphens`);
  for (const d of [1, 2, 3, 4, 5]) if (!t.stages?.[d]) errors.push(`${t.slug}: missing stage name ${d}`);
  let sets;
  try { sets = JSON.parse(readFileSync(new URL(`topics/${t.slug}/sets.json`, DATA))).sets; }
  catch (e) { errors.push(`${t.slug}: can't read sets.json (${e.message})`); continue; }
  const ids = new Set();
  for (const s of sets) {
    const at = `${t.slug} set ${s.id}`;
    if (ids.has(s.id)) errors.push(`${at}: duplicate id`); ids.add(s.id);
    if (!Number.isInteger(s.id)) errors.push(`${at}: id must be a whole number`);
    if (!Array.isArray(s.players) || s.players.length !== 4) errors.push(`${at}: needs exactly 4 items`);
    else if (new Set(s.players).size !== 4) errors.push(`${at}: repeated item`);
    if (!s.players?.includes(s.odd)) errors.push(`${at}: odd "${s.odd}" not in items`);
    if (!(s.d >= 1 && s.d <= 5)) errors.push(`${at}: d must be 1-5`);
    if (!s.link) errors.push(`${at}: missing link`);
  }
  console.log(`${t.slug}: ${sets.length} sets · per stage ${[1, 2, 3, 4, 5].map((d) => sets.filter((s) => s.d === d).length).join(" / ")}`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
