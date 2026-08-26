-- Run once on a fresh Supabase project, in the dashboard's SQL Editor.
-- Creates all four tables, the player_stats view, enables Row Level
-- Security with public-read-only policies, and creates the password-gated
-- functions that are the only way to write data.
-- See PLAN.md §4 for the design this implements.
--
-- Already have a database from an earlier version of this file? The
-- `create table` statements below will error on a table that already
-- exists — skip those and run just the `create extension`, the three
-- `create or replace function` blocks, and the `grant execute` lines to
-- pick up any function changes without touching your existing rows.

create extension if not exists pgcrypto;

create table players (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  -- Where a new player starts, and the floor no rating may cross. Both are
  -- mirrored by STARTING_ELO and MIN_ELO in web/src/lib/elo.ts, which document
  -- the reasoning — change them together, and shift every existing rating by
  -- the difference, or new players enter below the field they're rated against.
  -- computeGpElo already clamps at the floor; the constraint is the backstop
  -- that stops a stale or hand-rolled client writing a negative rating.
  elo           numeric not null default 100
                constraint players_elo_non_negative check (elo >= 0),
  gp_count      int not null default 0,
  created_at    timestamptz not null default now()
);

create table grand_prix (
  id            uuid primary key default gen_random_uuid(),
  played_at     timestamptz not null default now(),
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

-- Every function below is `security definer` (it runs as the table owner so it
-- can bypass RLS) and pins `search_path`, so a caller can't point an unqualified
-- table name at a schema they control.

create or replace function submit_gp(password text, results jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_gp_id uuid;
  r jsonb;
  current_elo numeric;
begin
  if not exists (
    select 1 from site_secret where password_hash = crypt(password, password_hash)
  ) then
    raise exception 'invalid password';
  end if;

  if jsonb_typeof(results) <> 'array' or jsonb_array_length(results) < 2 then
    raise exception 'a grand prix needs at least 2 players';
  end if;

  if (select count(distinct e.value->>'player_id') from jsonb_array_elements(results) e)
     <> jsonb_array_length(results) then
    raise exception 'the same player appears more than once in this grand prix';
  end if;

  -- Elo is computed client-side from the ratings the page loaded with. If
  -- someone else submitted a GP in the meantime those ratings are stale, so
  -- reject the whole submission rather than writing numbers derived from them.
  for r in select * from jsonb_array_elements(results) loop
    select elo into current_elo from players where id = (r->>'player_id')::uuid;

    if current_elo is null then
      raise exception 'unknown player %', r->>'player_id';
    end if;

    if current_elo <> (r->>'elo_before')::numeric then
      raise exception 'ratings changed since this page loaded - refresh and re-enter this grand prix';
    end if;
  end loop;

  insert into grand_prix default values returning id into new_gp_id;

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

-- Undoes the most recent grand prix: subtracts each participant's rating
-- change back off, drops their GP from the count, and deletes the GP itself
-- (gp_results cascades). To fix a mis-entered GP, void it and submit it again.
--
-- Deliberately limited to the *most recent* GP. Elo is path-dependent — every
-- later GP was rated against the ratings this one produced — so voiding an
-- older GP correctly would mean replaying every GP after it. Undoing only the
-- last one is exact arithmetic with no replay.
create or replace function void_last_gp(password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  target_id uuid;
begin
  if not exists (
    select 1 from site_secret where password_hash = crypt(password, password_hash)
  ) then
    raise exception 'invalid password';
  end if;

  select id into target_id
  from grand_prix
  order by played_at desc, created_at desc
  limit 1;

  if target_id is null then
    raise exception 'there is no grand prix to void';
  end if;

  update players p
    set elo = p.elo - r.elo_delta,
        gp_count = greatest(p.gp_count - 1, 0)
    from gp_results r
    where r.grand_prix_id = target_id
      and r.player_id = p.id;

  delete from grand_prix where id = target_id;

  return target_id;
end;
$$;

create or replace function add_player(password text, player_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

grant execute on function submit_gp(text, jsonb) to anon;
grant execute on function void_last_gp(text) to anon;
grant execute on function add_player(text, text) to anon;

-- Adds `players` to the supabase_realtime publication so the Leaderboard
-- page's live subscription (PLAN.md §6.2) actually receives postgres_changes
-- events. RLS's public SELECT policy above is necessary but not sufficient
-- for Realtime to broadcast changes — this is the other required half.
alter publication supabase_realtime add table players;
