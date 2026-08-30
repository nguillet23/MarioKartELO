# Mario Kart Elo

A friend-group Mario Kart Grand Prix tracker with a chess-style Elo rating
per player.

## Quick Commands

All commands run from inside `web/` unless noted otherwise.

**One-time setup**

```bash
cd web
npm install
cp .env.example .env
```

Open `web/.env` and fill in your Supabase project's URL and anon key
(dashboard → Project Settings → API). `.env` is gitignored — never commit
real keys, though the anon key is meant to be public anyway (it's exposed
in the client bundle either way; Row Level Security is what actually gates
access, not keeping this key secret).

**Run and check**

```bash
npm run dev        # dev server, then open the printed localhost URL
npx tsc --noEmit    # type-check without building
npm run lint        # static analysis (unused vars, hook rule violations, etc.)
npm run test        # unit tests for elo.ts and stats.ts
npm run build        # production build -> web/dist/
npm run preview     # serve that build locally (catches base-path issues npm run dev won't)
```

**Check it in the browser** (manual — the commands above only catch what
compiles/lints cleanly, not whether it actually looks/works right)

1. Click through every nav link (Leaderboard, Analytics, Head to Head,
   Submit GP) and confirm the active tab highlights, including short labels
   at phone width.
2. Open a racer's profile from the Leaderboard — rating chart, streaks,
   rival, and record vs. everyone should load, and every name should link
   onward correctly.
3. On Head to Head, pick two racers, reload the page (the picks live in the
   URL) and confirm the matchup persists; try the swap button too.
4. Submit a throwaway GP and check the recap panel (finishing order, rating
   changes, badges, biggest gain/loss) and the "Share result card" PNG,
   especially with your longest name and a full 12-racer field. Then void
   the GP — the recap should disappear with it.
5. Check the DevTools console for errors (Vite/React dev notices are fine).

Supabase-specific checks are in **Verifying Everything Works** below, after
the SQL setup.

## Supabase Setup

One-time SQL setup. Run in the Supabase dashboard's SQL Editor:

1. **`supabase/migrations/0001_init.sql`** — run once on a **fresh**
   project. Creates the four tables, the `player_stats` view, RLS with
   public-read-only policies, the password-gated write functions
   (`submit_gp`, `void_last_gp`, `add_player`), and adds `players` to the
   realtime publication for the Leaderboard's live updates.

   Upgrading an older database? The `create table` statements will error
   on tables that already exist — just re-run the `create extension`, the
   `create or replace function` blocks, and the `grant execute` lines
   (safe to run more than once).
2. **`supabase/reset_ratings.sql`** — *destructive*, not part of setup: wipes
   every recorded GP and resets everyone's rating, keeping the roster. Run
   only when changing `STARTING_ELO` / `DEFAULT_K` / `RATING_SCALE` in
   `web/src/lib/elo.ts` and the old history isn't worth keeping. No undo.
3. **`supabase/set_password.sql`** — run after step 1, and again any time
   you want to change the password. Replace `REPLACE_WITH_YOUR_PASSWORD`
   with your real password *in the SQL Editor only* — never commit that
   edit.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds `web/` and publishes to GitHub Pages
on every push to `main`. One-time setup:

1. Repo Settings → Pages → Build and deployment → Source → **GitHub
   Actions** (not "Deploy from a branch", which skips the build step).
2. Repo Settings → Secrets and variables → Actions → add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, matching your local
   `web/.env` (Vite bakes `VITE_*` vars in at build time).
3. Merge to `main` — the workflow only triggers there.

The live site must match the `base` in `web/vite.config.ts` (currently
`/MarioKartELO/`) or every asset 404s. The workflow runs `tsc --noEmit`,
`npm run lint`, and `npm run test` before building, so failures there block
the deploy.

## Verifying Everything Works

After running the Supabase setup above, in the dashboard's SQL Editor
(exact queries are one-liners against `site_secret`/`players`, write them
ad hoc):

- **Password is hashed**: `password_hash` in `site_secret` starts with
  `$2a$`/`$2b$` (bcrypt), never plaintext.
- **Auth actually gates writes**: a bogus password on `add_player` raises
  `invalid password` and adds nothing; the real password returns a UUID and
  a new `players` row (delete that test row after).
- **RLS is on**: `players`, `grand_prix`, `gp_results`, `site_secret` all
  show "RLS enabled" in the Table Editor (`player_stats` correctly shows
  "Unrestricted" — it's a view, not a table).
- **Voiding rolls back cleanly**: submit a throwaway GP, note the rating
  changes, then use "Void this grand prix" — ratings/GP counts should
  revert exactly and the GP should disappear from `grand_prix`.
- **Rating floor holds**: `update players set elo = -1;` should fail on the
  `players_elo_non_negative` check constraint.
- **Stale-rating guard works**: open Submit GP in two tabs, submit in one,
  then submit a different GP from the other (stale) tab — it should fail
  asking you to refresh, not silently overwrite the first GP.

## Notes

- `players`, `grand_prix`, and `gp_results` are publicly readable (that's
  what powers the Leaderboard and Analytics pages) but only writable
  through `submit_gp` and `add_player`, both password-gated.
- `site_secret` is never selectable by `anon` — it gets no RLS policy at
  all, so no client can read it directly. The write functions can still
  check the password because they're `security definer`, running as the
  table owner rather than as the caller.
- This is a shared-password model, not per-person auth: anyone with the
  password can submit or void a GP as if they were anyone, and there's no
  per-person audit trail or way to revoke just one person's access.
- Head-to-head records, streaks, rivals, personal bests, and recaps are all
  derived in the browser from `gp_results` (`web/src/lib/stats.ts`) — no
  schema change or migration needed for any of it.
