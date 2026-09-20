-- Configurable races per grand prix. Run once in the dashboard's SQL Editor,
-- on a database that has already run 0001_init.sql. Run it BEFORE deploying
-- the web app that reads `grand_prix.races` — until the column exists, every
-- page that loads history will error.
--
-- Until now every grand prix was assumed to be exactly 4 races, so a result's
-- points had to fall in 4..60 (4 races x 1..15, Mario Kart 8 Deluxe's 12-player
-- scoring). This lets a GP span 4..48 races. It only changes how many races'
-- points get summed into one total — there is still no per-race data, and
-- `gp_results` is still one row per player per GP. See PLAN.md, "Configurable
-- races per grand prix".
--
-- Safe to re-run: every step is guarded, and the backfill default means
-- existing grand prix keep the 4-race meaning their points always had.

-- 1. `races` on the grand prix itself. `default 4` backfills every existing
--    row, so historical results keep the point range they were entered under.
--    Mirrored by MIN_RACES / MAX_RACES / DEFAULT_RACES in web/src/lib/elo.ts.
alter table grand_prix
  add column if not exists races int not null default 4;

alter table grand_prix drop constraint if exists grand_prix_races_check;
alter table grand_prix
  add constraint grand_prix_races_check check (races between 4 and 48);

-- 2. gp_results' hardcoded `points between 4 and 60` can't stay: a column check
--    can't see grand_prix.races on another table, and 60 is wrong for any GP
--    that isn't 4 races long. The real range check moves into submit_gp below;
--    this is just a loose sanity floor.
alter table gp_results drop constraint if exists gp_results_points_check;
alter table gp_results drop constraint if exists gp_results_points_non_negative;
alter table gp_results
  add constraint gp_results_points_non_negative check (points >= 0);

-- 3. submit_gp gains a fourth parameter. `create or replace` cannot change a
--    function's argument list, so the old 3-argument version has to be dropped
--    first (or it lingers alongside the new one). Dropping it also drops its
--    grant, which is re-issued at the bottom.
drop function if exists submit_gp(text, jsonb, timestamptz);

-- `played_at` and `races` both default to null, which resolve to now() and 4
-- below — the common case needs no extra arguments. The parameter is resolved
-- into `resolved_races` once, up front, so no query below has to use the bare
-- name `races` (which is also a grand_prix column).
create or replace function submit_gp(
  password text,
  results jsonb,
  played_at timestamptz default null,
  races int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_gp_id uuid;
  r jsonb;
  current_elo numeric;
  resolved_played_at timestamptz := coalesce(played_at, now());
  resolved_races int := coalesce(races, 4);
  latest_played_at timestamptz;
  result_points int;
begin
  if not exists (
    select 1 from site_secret where password_hash = crypt(password, password_hash)
  ) then
    raise exception 'invalid password';
  end if;

  if jsonb_typeof(results) <> 'array' or jsonb_array_length(results) < 4 then
    raise exception 'a grand prix needs at least 4 players';
  end if;

  if (select count(distinct e.value->>'player_id') from jsonb_array_elements(results) e)
     <> jsonb_array_length(results) then
    raise exception 'the same player appears more than once in this grand prix';
  end if;

  if resolved_races < 4 or resolved_races > 48 then
    raise exception 'a grand prix needs between 4 and 48 races, got %', resolved_races;
  end if;

  -- Each race is worth 1..15 points (12-player Mario Kart 8 Deluxe scoring), so
  -- a total over N races is only possible between N and N*15. This is the check
  -- that used to be `gp_results.points between 4 and 60`.
  for r in select * from jsonb_array_elements(results) loop
    result_points := (r->>'points')::int;
    if result_points < resolved_races * 1 or result_points > resolved_races * 15 then
      raise exception 'points must be between % and % for a % race grand prix, got %',
        resolved_races * 1, resolved_races * 15, resolved_races, result_points;
    end if;
  end loop;

  if resolved_played_at > now() then
    raise exception 'played_at cannot be in the future';
  end if;

  -- Every rating below is computed client-side against each player's
  -- *current* elo, not whatever it was as of resolved_played_at. Backdating
  -- is only safe when it slots in after everything already on record —
  -- inserting it earlier would credit or charge players against ratings
  -- they hadn't reached yet at that point in real history.
  select max(g.played_at) into latest_played_at from grand_prix g;
  if latest_played_at is not null and resolved_played_at < latest_played_at then
    raise exception
      'played_at (%) is before the most recent grand prix (%) - backdating can only fill in a gap after everything already on record',
      resolved_played_at, latest_played_at;
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

  insert into grand_prix (played_at, races)
    values (resolved_played_at, resolved_races)
    returning id into new_gp_id;

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

grant execute on function submit_gp(text, jsonb, timestamptz, int) to anon;

-- void_last_gp needs no change: it undoes a GP by subtracting each stored
-- elo_delta back off, which doesn't depend on how many races produced it.
