// Builds each topic's photos.json from its photos-source.json, for every topic in public/data/topics.json.
// Files live in public/data/topics/<slug>/.
//
// photos-source.json maps each item (player, thing, place) to a Wikimedia Commons file, e.g.
//   "Thierry Henry": "File:Thierry Henry 2012.jpg"
// You can paste the file name, or the whole Commons page URL. Leave "" for players without a photo yet.
// A value can also be a list of candidates in order of preference; the first one that is on Commons
// with a free licence is used, e.g. "Kolo Touré": ["File:First choice.jpg", "File:Backup.jpg"]
//
// For each file this looks up the photographer and licence on Commons, keeps only freely licensed
// images (CC BY, CC BY-SA, CC0, public domain, OGL and similar attribution licences), and writes the image URL + credit line the game shows.
//
//   node tools/build-photos.mjs               build; warn about problems; list players still missing a photo
//   node tools/build-photos.mjs --strict      exit 1 on any problem or missing photo (use before a release)
//   node tools/build-photos.mjs --unverified  no network: write photos.json straight from the source list with a
//                                             generic credit. For local previews only; CI replaces it with verified data.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA = new URL("../public/data/", import.meta.url);
const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks automated clients to identify themselves. Add your site URL here once it's live.
const UA = "FoursACrowd-photo-builder/1.0 (quiz game; https://github.com/)";
const WIDTH = 480;
const FREE = /^(cc[ -]?by(-sa)?([ -]\d(\.\d)?)?|cc0|public domain|pd|ogl|open government licen[cs]e|attribution|fal|copyrighted free use|mit|gfdl)/i;
const NOT_FREE = /\b(nc|nd)\b|non-?commercial|no ?deriv/i;

const strict = process.argv.includes("--strict");
const unverified = process.argv.includes("--unverified");
const filePath = (title) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title.slice(5).replace(/ /g, "_"))}`;

// Keep photos-source.json in step with the question sets: add any new items with an empty value.
function syncSource(dir) {
  const SRC = new URL("photos-source.json", dir);
  const allPlayers = [...new Set(JSON.parse(readFileSync(new URL("sets.json", dir))).sets.flatMap((s) => s.players))].sort((a, b) => a.localeCompare(b));
  const source = existsSync(SRC) ? JSON.parse(readFileSync(SRC)) : { players: {} };
  let added = 0;
  for (const p of allPlayers) if (!(p in source.players)) { source.players[p] = ""; added++; }
  const sorted = Object.fromEntries(Object.entries(source.players).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(SRC, JSON.stringify({ ...source, players: sorted }, null, 2) + "\n");
  if (added) console.log(`  added ${added} new item(s) to photos-source.json`);
  return { allPlayers, sorted };
}

export function toTitle(v) {
  if (!v) return null;
  let t = v.trim();
  const m = t.match(/commons\.(?:m\.)?wikimedia\.org\/wiki\/(File:[^?#]+)/i);
  if (m) t = decodeURIComponent(m[1]);
  t = t.replace(/_/g, " ");
  if (!/^file:/i.test(t)) t = "File:" + t;
  return "File:" + t.slice(5);
}
export const stripHtml = (s = "") => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();

export function parse(json, wanted) {
  // wanted: Map(title -> { player, rank }). Commons may normalise or redirect titles.
  const alias = new Map();
  for (const n of json.query?.normalized || []) alias.set(n.to, n.from);
  for (const r of json.query?.redirects || []) alias.set(r.to, alias.get(r.from) || r.from);
  const out = {}, errors = [];
  for (const page of json.query?.pages || []) {
    const asked = wanted.has(page.title) ? page.title : alias.get(page.title) || page.title;
    const w = wanted.get(asked);
    if (!w) continue;
    const { player, rank } = w;
    const info = page.imageinfo?.[0];
    if (page.missing || !info) { errors.push({ player, rank, msg: `${player}: "${asked}" not found on Commons` }); continue; }
    const md = info.extmetadata || {};
    const licence = stripHtml(md.LicenseShortName?.value);
    const artist = stripHtml(md.Artist?.value) || "Unknown author";
    if (!FREE.test(licence) || NOT_FREE.test(licence)) { errors.push({ player, rank, msg: `${player}: licence "${licence || "unknown"}" on "${asked}" isn't free to reuse` }); continue; }
    const credit = `${artist.length > 40 ? artist.slice(0, 39) + "…" : artist} / ${licence}`;
    out[player] = out[player] || [];
    out[player].push({ rank, photo: { src: info.thumburl || info.url, page: info.descriptionurl, credit, licence, file: page.title } });
  }
  return { out, errors };
}

async function lookup(titles) {
  const url = `${API}?action=query&format=json&formatversion=2&redirects=1&prop=imageinfo&iiprop=url|extmetadata` +
    `&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=${WIDTH}&titles=${encodeURIComponent(titles.join("|"))}`;
  const r = await fetch(url, { headers: { "user-agent": UA, "api-user-agent": UA } });
  if (!r.ok) throw new Error(`Commons API ${r.status}`);
  return r.json();
}

async function main() {
  const { topics } = JSON.parse(readFileSync(new URL("topics.json", DATA)));
  let fail = false;
  for (const t of topics) {
    console.log(`\n[${t.slug}] ${t.title}`);
    const r = await buildTopic(t);
    if (r === "offline") break;
    fail = fail || r;
  }
  if (fail) process.exit(1);
}

async function buildTopic(topic) {
  const dir = new URL(`topics/${topic.slug}/`, DATA);
  const OUT = new URL("photos.json", dir);
  const { allPlayers, sorted } = syncSource(dir);
  const wanted = new Map();
  const list = (v) => (Array.isArray(v) ? v : [v]).map(toTitle).filter(Boolean);
  for (const [player, v] of Object.entries(sorted)) list(v).forEach((t, rank) => { if (!wanted.has(t)) wanted.set(t, { player, rank }); });
  const missing = allPlayers.filter((p) => !list(sorted[p]).length);

  const photos = {}, candidates = {}, rawErrors = [];
  const titles = [...wanted.keys()];
  if (unverified) {
    for (const [t, { player, rank }] of wanted) if (rank === 0) photos[player] = { src: filePath(t) + "?width=480", page: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(t.replace(/ /g, "_")), credit: "Wikimedia Commons", licence: "unverified", file: t };
    console.warn("UNVERIFIED: licences not checked and credits are generic. Run without --unverified before publishing.");
  } else try {
    for (let i = 0; i < titles.length; i += 50) {
      const { out, errors: e } = parse(await lookup(titles.slice(i, i + 50)), wanted);
      for (const [p, c] of Object.entries(out)) (candidates[p] = candidates[p] || []).push(...c);
      rawErrors.push(...e);
    }
  } catch (err) {
    console.warn(`Couldn't reach Wikimedia Commons (${err.message}). Keeping the existing photos.json files.`);
    return "offline";
  }

  for (const [p, c] of Object.entries(candidates)) photos[p] = c.sort((a, b) => a.rank - b.rank)[0].photo;
  // Only report a player as a problem if none of their candidates worked.
  const errors = rawErrors.filter((e) => !photos[e.player]).map((e) => e.msg);
  const ordered = Object.fromEntries(Object.entries(photos).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`  photos.json: ${Object.keys(ordered).length} of ${allPlayers.length} items have a photo`);

  const TODO = new URL(`photos-todo/${topic.slug}.md`, import.meta.url);
  const hint = topic.slug === "premier-league" ? " footballer" : "";
  const search = (p) => `https://commons.wikimedia.org/w/index.php?title=Special:MediaSearch&type=image&search=${encodeURIComponent(p + hint)}`;
  writeFileSync(TODO, `# ${topic.title}: items still needing a photo (${missing.length})\n\nOpen the link, pick a clear photo, open the file page and copy its name\n(e.g. \`File:Example 2012.jpg\`) into public/data/topics/${topic.slug}/photos-source.json. Then run \`node tools/build-photos.mjs\`.\n\n` +
    missing.map((p) => `- [ ] ${p}: ${search(p)}`).join("\n") + "\n");
  if (missing.length) console.log(`  ${missing.length} still need a photo. Checklist: tools/photos-todo/${topic.slug}.md`);
  if (errors.length) console.error(`  Problems (${errors.length}; these show initials instead):\n    ` + errors.join("\n    "));
  return strict && (errors.length || missing.length);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
