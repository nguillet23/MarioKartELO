-- Run once on a fresh Supabase project, in the dashboard's SQL Editor.
-- Creates all four tables, the player_stats view, enables Row Level
-- Security with public-read-only policies, and creates the two
-- password-gated functions that are the only way to write data.
-- See PLAN.md §4 for the design this implements.

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

create or replace function submit_gp(password text, results jsonb)
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

grant execute on function submit_gp(text, jsonb) to anon;
grant execute on function add_player(text, text) to anon;

-- Adds `players` to the supabase_realtime publication so the Leaderboard
-- page's live subscription (PLAN.md §6.2) actually receives postgres_changes
-- events. RLS's public SELECT policy above is necessary but not sufficient
-- for Realtime to broadcast changes — this is the other required half.
alter publication supabase_realtime add table players;
