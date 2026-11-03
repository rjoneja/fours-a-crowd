# Four's a Crowd

Four of them. Three share a link. Pick the one who doesn't belong.
3 lives, 100 sets across five stages, easiest first. The first topic is Premier League footballers, 1992–2026; the topic name on the start screen comes from `theme` in `sets.json`.

```
public/                 static files, served directly by Cloudflare
  index.html            the game
  data/sets.json        the question sets and topic name
  data/photos-source.json  which Commons photo to use for each player
  data/photos.json      built from photos-source.json (image link + credit)
  dashboard/index.html  standalone analytics dashboard
src/
  worker.js             routes /api/* to the handlers below, everything else to public/
  api/event.js          POST /api/event   game → D1
  api/stats.js          GET  /api/stats   dashboard numbers (token)
  api/export.js         GET  /api/export  every pick as CSV (token)
schema.sql              D1 tables: players, sessions, attempts
tools/validate-sets.mjs checks sets.json
tools/build-photos.mjs  checks photo licences on Commons, writes photos.json
```

## Deploy (Cloudflare Worker, connected to GitHub)

It runs as a Worker with static assets. `wrangler.toml` holds the name, the D1 binding and the assets folder, so the dashboard only needs the build settings and the secret.

1. D1 database `fours-a-crowd` created and `schema.sql` run in its Console. Its ID is in `wrangler.toml`.
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
For every click: set, stage, position in the run, attempt number, correct/wrong, milliseconds since the set appeared, which card, lives left.
Add a short privacy line to the start screen before you share it widely; this is basic analytics, no cookies, no personal data beyond the optional name.

## Photos (free, from Wikimedia Commons)

Cards show initials until a player has a photo. From set 11, names are hidden on any card that has a photo and are revealed when you pick it, on a correct answer, or at game over. Change the round with `hideNamesAfter` in `index.html`.

`public/data/photos-source.json` already names a Commons file for 197 of the 199 players: the photo each player's English Wikipedia article uses in its infobox. Two have no free photo (Juninho, Robbie Earle) and show initials.

- To change or add one: open `tools/photos-todo.md` (search links for anyone still missing), pick a clear head-and-shoulders photo on Commons, and paste its file name (e.g. `File:Example player 2019.jpg`) or page URL against the player in `photos-source.json`.
- Run `npm run photos`. This looks up the photographer and licence on Commons, keeps only free licences (CC BY, CC BY-SA, CC0, public domain, OGL), and writes `public/data/photos.json` with the credit line. Problem files are listed and that player falls back to initials. `--strict` makes problems fail the build.
- The checked-in `photos.json` was built with `--unverified` (no Commons access where it was made): image links are right but credits are generic. Cloudflare's build step rebuilds it with verified licences and credits on every deploy.

Each card shows the credit line and the answer pop-up links every photo to its Commons page, which covers the attribution the licences require. Images load from Wikimedia's servers.

If your database was created before this change, run `migrations/0002_names_hidden.sql` once (the analytics now record how many names were hidden on each pick).

## Adding or re-tiering sets

Edit `public/data/sets.json`. Each set: `id`, `d` (1–5), `players` (4 names), `odd`, `link` (what the other three share), `oddNote` (why the odd one doesn't fit). `node tools/validate-sets.mjs` catches mistakes.
The dashboard flags sets whose observed first-try accuracy is well off the target for their stage.

## Towards XGBoost difficulty

`/api/export` gives one row per pick with session context (player's prior accuracy, sessions played, position, lives left, time).
Once you have a few thousand rows: train a classifier on `correct` for `attempt_no = 1`, with features per set (authored stage, link type, era, nationality-based or not) plus player features. Use the predicted probability to order sets per player, aiming for roughly 70% first-try success, then serve that order from a new `/api/next` function instead of the fixed stage order in `buildQueue()`.
