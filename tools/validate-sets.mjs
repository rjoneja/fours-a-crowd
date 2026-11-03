// Fails the build if any set is malformed: run with `node tools/validate-sets.mjs`
import { readFileSync } from "node:fs";
const { sets } = JSON.parse(readFileSync(new URL("../public/data/sets.json", import.meta.url)));
const errors = [], ids = new Set();
for (const s of sets) {
  if (ids.has(s.id)) errors.push(`duplicate id ${s.id}`); ids.add(s.id);
  if (!Array.isArray(s.players) || s.players.length !== 4) errors.push(`set ${s.id}: needs exactly 4 players`);
  else if (new Set(s.players).size !== 4) errors.push(`set ${s.id}: repeated player`);
  if (!s.players?.includes(s.odd)) errors.push(`set ${s.id}: odd "${s.odd}" not in players`);
  if (!(s.d >= 1 && s.d <= 5)) errors.push(`set ${s.id}: d must be 1-5`);
  if (!s.link) errors.push(`set ${s.id}: missing link`);
}
const byD = [1,2,3,4,5].map(d => sets.filter(s => s.d === d).length);
console.log(`${sets.length} sets · per stage ${byD.join(" / ")}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
