# Four's a Crowd

Four of them. Three share a link. Pick the one who doesn't belong.
3 lives per go, sets get harder as you go. Players pick a topic on the start screen.

Topics so far:
- **Premier League footballers** (100 sets). Names hidden after set 10 so you have to recognise faces.
- **Surprising general knowledge** (561 sets across food, animals, geography, science and culture; each go draws 56, unseen ones first). The obvious answer is usually wrong.

```
public/                     static files, served directly by Cloudflare
  index.html                the game
  dashboard/index.html      standalone analytics dashboard
  data/topics.json          list of topics: title, stage names, wording, look, lives icon, hideNamesAfter
  data/topics/<slug>/
    sets.json               the question sets (each set: id, d 1-5, 4 items, odd, link, oddNote)
    photos-source.json      which Commons photo(s) to use for each item
    photos.json             built from photos-source.json (image link + credit)
src/
  worker.js                 routes /api/* to the handlers below, everything else to public/
  api/event.js              POST /api/event   game → D1
  api/stats.js              GET  /api/stats?topic=<slug>   dashboard numbers (token)
  api/export.js             GET  /api/export  every pick as CSV, with topic column (token)
schema.sql                  D1 tables: players, sessions, attempts
migrations/                 one-off changes for an existing database
tools/validate-sets.mjs     checks every topic's sets
tools/build-photos.mjs      checks photo licences on Commons, writes each topic's photos.json
tools/photos-todo/<slug>.md items still without a photo, with search links
```

## Adding a topic

1. Add an entry to `public/data/topics.json` (copy an existing one; `slug` is lowercase with hyphens).
2. Create `public/data/topics/<slug>/sets.json`. Item names go in the `players` array whatever the topic.
3. Run `npm run build`. It checks the sets and adds every item to that topic's `photos-source.json` with an empty value.
4. Fill in Commons file names in `photos-source.json` (one name, or a list of candidates in order of preference) and run `npm run build` again.

## Deploy (Cloudflare Worker, connected to GitHub)

It runs as a Worker with static assets. `wrangler.toml` holds the name, the D1 binding and the assets folder, so the dashboard only needs the build settings and the secret.

1. D1 database `fours-a-crowd` created and `schema.sql` run in its Console. Its ID is in `wrangler.toml`. If the database was created before a file in `migrations/` was added, run that file in the Console once.
2. Workers & Pages → the `fours-a-crowd` Worker → Settings → Build:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. Settings → Variables and Secrets → add secret `DASHBOARD_TOKEN`.
4. Settings → Domains & Routes → add a custom domain, e.g. `foursacrowd.yourdomain.com`.
5. Zero Trust → Access → Applications → Self-hosted: protect `/dashboard`, `/api/stats` and `/api/export` with an Allow policy for your email.

Every push to `main` builds and deploys.

Local: `npm install`, `npm run db:init:local`, put `DASHBOARD_TOKEN=devtoken` in `.dev.vars`, then `npm run dev` → http://localhost:8787 and /dashboard/.

## What gets tracked

Each browser gets an anonymous id; players can add a name at kick-off. Country comes from Cloudflare.
Per pick: topic, set, stage, position in the go, attempt number, right/wrong, milliseconds since the set appeared,
which card, **quadrant pressed** and **quadrant holding the answer**, **times the player left the tab or window**
during the question and **how long they were away**, lives left.
Per go: start, end, how it ended (out of lives, completed, left), and if they left, **the set on screen** and whether
it was **mid-question or on the answer pop-up**. A go with no end event and 30 minutes of silence counts as left.

Answers are placed so that in every block of four sets the answer sits once in each quadrant.

Every set has `tags`: `domain` and `kind` (the type of link). The dashboard groups wrong %, time, tab-leaving and
quits by type as well as by set.

Add a short privacy line to the start screen before you share it widely; this is basic analytics, no cookies,
no personal data beyond the optional name.

## Photos (free, from Wikimedia Commons)

Cards show initials until a player has a photo. From set 11, names are hidden on any card that has a photo and are revealed when you pick it, on a correct answer, or at game over. Change the round with `hideNamesAfter` in `index.html`.

`public/data/topics/premier-league/photos-source.json` already names a Commons file for 197 of the 199 players: the photo each player's English Wikipedia article uses in its infobox. Two have no free photo (Juninho, Robbie Earle) and show initials.

- To change or add one: open `tools/photos-todo/<slug>.md` (search links for anyone still missing), pick a clear head-and-shoulders photo on Commons, and paste its file name (e.g. `File:Example player 2019.jpg`) or page URL against the player in `photos-source.json`.
- Run `npm run photos`. This looks up the photographer and licence on Commons, keeps only free licences (CC BY, CC BY-SA, CC0, public domain, OGL), and writes each topic's `photos.json` with the credit line. Problem files are listed and that item falls back to initials. `--strict` makes problems fail the build.
- The checked-in `photos.json` was built with `--unverified` (no Commons access where it was made): image links are right but credits are generic. Cloudflare's build step rebuilds it with verified licences and credits on every deploy.

Each card shows the credit line and the answer pop-up links every photo to its Commons page, which covers the attribution the licences require. Images load from Wikimedia's servers.

If your database was created before this change, run `migrations/0002_names_hidden.sql` once (the analytics now record how many names were hidden on each pick).

## Adding or re-tiering sets

Edit `public/data/topics/<slug>/sets.json`. Each set: `id`, `d` (1–5), `players` (4 names), `odd`, `link` (what the other three share), `oddNote` (why the odd one doesn't fit). `node tools/validate-sets.mjs` catches mistakes.
The dashboard flags sets whose observed first-try accuracy is well off the target for their stage.

## Towards XGBoost difficulty

`/api/export` gives one row per pick with everything above plus the player's history (prior accuracy, goes played)
and `quit_here` (1 on the last pick of a go the player abandoned).

1. **Now (little data):** give each set a difficulty rating and each player a skill rating, updated after every first
   pick the way chess (Elo) ratings are. Calibrates from a few dozen plays per set.
2. **Later (a few thousand first-try picks):** XGBoost models on the export.
   - `correct` on first attempt: features = set rating, stage, domain, kind, names hidden, answer quadrant,
     position in the go, lives left, player prior accuracy, goes played, device.
   - `quit_here`: same features plus how many wrong picks so far this go.
   - Flag picks with long `ms` and `blurs > 0` as possible look-ups and exclude or down-weight them when training.
3. Use the two predictions to choose each player's next set: aim for roughly 70% first-try success while keeping
   predicted quit risk low. Serve it from a new `/api/next` route instead of the fixed stage order in `buildQueue()`.
