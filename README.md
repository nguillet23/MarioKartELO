# Mario Kart Elo

A friend-group Mario Kart Grand Prix tracker with a chess-style Elo rating
per player. See `PLAN.md` for the full design.

## Quick Commands

Everything needed to run the app and check any change, in one place —
no digging through the Supabase SQL below. All commands run from inside
`web/` unless noted otherwise.

**One-time setup**

Install dependencies:

```bash
cd web
npm install
```

Create your local env file:

```bash
cp .env.example .env
```

Then open `web/.env` and fill in your Supabase project's URL and anon key
(dashboard → Project Settings → API). `.env` is gitignored — never commit
real keys, though the anon key is meant to be public anyway (see
`PLAN.md` §1).

**Run it**

```bash
npm run dev
```

Then open the printed `localhost` URL in a browser.

**Check the code**

Type-check without building:

```bash
npx tsc --noEmit
```

Static analysis (unused vars, hook rule violations, etc.):

```bash
npm run lint
```

Run unit tests (currently just `elo.ts` — the pure Elo algorithm):

```bash
npm run test
```

Production build, outputs to `web/dist/`:

```bash
npm run build
```

Serve that production build locally — different from `npm run dev`'s
dev-mode server; catches anything that only breaks in the built output,
e.g. the `/MarioKartELO/` base path:

```bash
npm run preview
```

**Check it in the browser** (manual — the commands above only catch what
compiles/lints cleanly, not whether it actually looks/works right)

1. `npm run dev`, open the printed `localhost` URL.
2. Click through all the nav links (currently: Leaderboard `/`, Analytics
   `/analytics`, Submit GP `/submit`) — each should load and highlight
   the active tab.
3. Open the browser DevTools console (F12) and confirm there are no red
   errors — Vite's HMR connect messages and React's DevTools notice are
   normal and fine to ignore.

Supabase-specific checks (need the SQL setup below run first) are in
**Verifying Everything Works** further down.

## Supabase Setup

This is the one-time SQL setup for the Supabase project, matching the
design in `PLAN.md`. The actual SQL lives in the repo, not here:

1. **`supabase/migrations/0001_init.sql`** — run once on a fresh Supabase
   project, in the dashboard's SQL Editor. Creates all four tables, the
   `player_stats` view, enables Row Level Security with public-read-only
   policies, creates the two password-gated functions (`submit_gp`,
   `add_player`) that are the only way to write data, and adds `players`
   to the `supabase_realtime` publication so the Leaderboard page's live
   subscription actually receives updates.
2. **`supabase/set_password.sql`** — run separately, after step 1. Open
   the file, replace `REPLACE_WITH_YOUR_PASSWORD` with your actual chosen
   password *in the SQL Editor only* (never commit that
   edit — the file in the repo should always keep the placeholder), then
   run it. This is
   also how you change the password later: re-run it with a new value.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds `web/` and publishes it to GitHub
Pages on every push to `main` (or manually from the Actions tab). Three
one-time setup steps before the first deploy works:

1. **Turn on Pages**: repo Settings → Pages → Build and deployment →
   Source → **GitHub Actions** (not "Deploy from a branch" — that skips
   the build step, and the `.tsx` source can't be served directly).
2. **Add the two secrets**: repo Settings → Secrets and variables →
   Actions → New repository secret. Add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` with the same values as your local
   `web/.env`. Vite bakes `VITE_*` vars into the bundle at build time, so
   without these the deployed site can't reach Supabase.
3. **Merge to `main`**: the workflow only triggers on `main`, so work on
   other branches won't deploy until merged.

The live site will be at `https://<username>.github.io/<repo-name>/` —
this must match the `base` in `web/vite.config.ts` (currently
`/MarioKartELO/`) or every asset 404s.

The workflow runs `tsc --noEmit`, `npm run lint`, and `npm run test`
before building, so a type error, lint error, or failing test blocks the
deploy rather than shipping broken output.

## Verifying Everything Works

Supabase-specific checks — see **Quick Commands** above for the web app
and git checks. This section grows as more gets built. Do each of these
in the dashboard's SQL Editor, after running the setup above (exact
queries aren't repeated here — write them ad hoc, they're one-liners
against `site_secret`/`players`):

- Confirm the password is actually hashed, not stored as plaintext:
  select `password_hash` from `site_secret` and check it starts with
  `$2a$` or `$2b$` (bcrypt), never your literal password.
- Confirm a wrong password is rejected: call `add_player` with a bogus
  password — it should raise `invalid password` and add nothing.
- Confirm the right password works: call `add_player` with the real
  password — it should return a UUID and add a row to `players`. Delete
  that test row afterward so it doesn't linger in your roster.
- In the Table Editor: `players`, `grand_prix`, `gp_results`,
  `site_secret` should all show a green "RLS enabled" badge (`player_stats`
  will say "Unrestricted" instead — expected, since RLS only applies to
  tables, not views).

## Notes

- `players`, `grand_prix`, and `gp_results` are readable by anyone (that's
  what powers the public Leaderboard and Analytics pages) but not writable
  by anyone directly — the only way rows get created is through
  `submit_gp` and `add_player`, and both refuse to do anything unless the
  correct password is passed in.
- `site_secret` itself is never selectable by `anon`, even though the
  functions above can read it internally — see `PLAN.md` §4 for why.
- This is a shared-password model, not real per-person authentication. See
  `PLAN.md` §4 for the tradeoff that comes with that choice.
