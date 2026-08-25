# Mario Kart Elo

A friend-group Mario Kart Grand Prix tracker with a chess-style Elo rating
per player. See `PLAN.md` for the full design.

## Local Development

The app lives in `web/` (Vite + React + TypeScript + Tailwind).

1. Install dependencies:
   - `cd web`
   - `npm install`
2. Copy `web/.env.example` to `web/.env` and fill in your Supabase
   project's URL and anon key (Supabase dashboard → Project Settings →
   API). `.env` is gitignored — never commit real keys, though the anon
   key is meant to be public anyway (see `PLAN.md` §1).
3. Run the dev server: `npm run dev` (from inside `web/`).
4. Build for production: `npm run build` — outputs to `web/dist/`, with
   the `/MarioKartELO/` base path already configured in `vite.config.ts`
   for GitHub Pages hosting.

## Supabase Setup

This is the one-time SQL setup for the Supabase project, matching the
design in `PLAN.md`. Paste each block into the Supabase dashboard's
**SQL Editor** and run it, in order.

### 1. Schema, view, RLS, and write-access functions

Run this once on a fresh Supabase project. It creates all four tables, the
`player_stats` view, enables Row Level Security with public-read-only
policies, and creates the two password-gated functions that are the only
way to write data.

```sql
create extension if not exists pgcrypto;

create table players (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  elo           numeric not null default 1500,
  gp_count      int not null default 0,
  created_at    timestamptz not null default now()
);

create table grand_prix (
  id            uuid primary key default gen_random_uuid(),
  played_at     timestamptz not null default now(),
  label         text,
  created_at    timestamptz not null default now()
);

create table gp_results (
  id            uuid primary key default gen_random_uuid(),
  grand_prix_id uuid not null references grand_prix(id) on delete cascade,
  player_id     uuid not null references players(id),
  points        int not null check (points between 4 and 60),
  elo_before    numeric not null,
  elo_after     numeric not null,
  elo_delta     numeric not null,
  unique (grand_prix_id, player_id)
);

create table site_secret (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);

create view player_stats as
select
  p.id, p.name, p.elo, p.gp_count,
  coalesce(sum(r.points), 0)                                 as total_points,
  coalesce(sum(r.points), 0)::numeric / nullif(p.gp_count, 0) as avg_points
from players p
left join gp_results r on r.player_id = p.id
where p.gp_count > 0
group by p.id;

alter table players     enable row level security;
alter table grand_prix  enable row level security;
alter table gp_results  enable row level security;
alter table site_secret enable row level security;

create policy "public read players"    on players    for select to anon using (true);
create policy "public read grand_prix" on grand_prix for select to anon using (true);
create policy "public read gp_results" on gp_results for select to anon using (true);
-- site_secret gets no policy at all: no one can select/insert/update it directly,
-- not even anon reading it, only the functions below (they bypass RLS as the table owner).

grant select on players, grand_prix, gp_results, player_stats to anon;

create or replace function submit_gp(password text, gp_label text, results jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  new_gp_id uuid;
  r jsonb;
begin
  if not exists (
    select 1 from site_secret where password_hash = crypt(password, password_hash)
  ) then
    raise exception 'invalid password';
  end if;

  insert into grand_prix (label) values (gp_label) returning id into new_gp_id;

  for r in select * from jsonb_array_elements(results) loop
    insert into gp_results (grand_prix_id, player_id, points, elo_before, elo_after, elo_delta)
    values (
      new_gp_id,
      (r->>'player_id')::uuid,
      (r->>'points')::int,
      (r->>'elo_before')::numeric,
      (r->>'elo_after')::numeric,
      (r->>'elo_delta')::numeric
    );

    update players
      set elo = (r->>'elo_after')::numeric,
          gp_count = gp_count + 1
      where id = (r->>'player_id')::uuid;
  end loop;

  return new_gp_id;
end;
$$;

create or replace function add_player(password text, player_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  new_id uuid;
begin
  if not exists (
    select 1 from site_secret where password_hash = crypt(password, password_hash)
  ) then
    raise exception 'invalid password';
  end if;

  insert into players (name) values (player_name) returning id into new_id;
  return new_id;
end;
$$;

grant execute on function submit_gp(text, text, jsonb) to anon;
grant execute on function add_player(text, text) to anon;
```

### 2. Set the site password

Run this separately — replace `REPLACE_WITH_YOUR_PASSWORD` with the actual
password before running. This is also how you change the password later
(just run it again with a new value; the `on conflict` makes it an upsert).

```sql
insert into site_secret (id, password_hash)
values (1, crypt('REPLACE_WITH_YOUR_PASSWORD', gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;
```

## Verifying Everything Works

Commands to independently check things yourself — this section grows as
more gets built.

**Git / repo state**
- `git status` — see what's staged, modified, or untracked.
- `git ls-files` — see exactly what git is tracking (e.g. confirm
  `PLAN.md` does *not* show up — it's intentionally excluded via the root
  `.gitignore`, kept local-only on purpose).
- `git check-ignore -v <path>` — see which `.gitignore` line (and which
  file) is excluding a given path, if a file you expect to be tracked
  isn't.

**Web app (`web/`)**
- `cd web && npm install` — install dependencies.
- `cd web && npm run dev` — start the local dev server, then open the
  printed `localhost` URL in a browser and click through the pages.
- `cd web && npx tsc --noEmit` — type-check without building.
- `cd web && npm run build` — production build, outputs to `web/dist/`.

**Supabase** (in the dashboard's SQL Editor, after running the setup in
the section above)
- `select password_hash from site_secret;` — should return a bcrypt hash
  (starts with `$2a$` or `$2b$`), never your literal password.
- `select add_player('wrong-password', 'Test Player');` — should raise
  `invalid password` and add nothing.
- `select add_player('your-real-password', 'Test Player');` — should
  return a UUID and add a row to `players` (delete it afterward with
  `delete from players where name = 'Test Player';` so it doesn't linger).
- Table Editor — confirm `players`, `grand_prix`, `gp_results`,
  `site_secret` all show a green "RLS enabled" badge (`player_stats`
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
