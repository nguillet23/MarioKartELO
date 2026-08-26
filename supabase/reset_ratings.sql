-- Wipes every recorded grand prix and puts all characters back to a fresh
-- rating, keeping the roster. Run it in the dashboard's SQL Editor.
--
-- DESTRUCTIVE: every grand prix and result is deleted permanently, and there
-- is no undo. `void_last_gp` only ever unwinds the most recent GP; this is
-- the blunt version, meant for development or a deliberate "new season".
--
-- Written for the switch to a 100 starting rating with a floor at 0 (see
-- STARTING_ELO, MIN_ELO, and RATING_SCALE in web/src/lib/elo.ts), but it's the
-- right script any time the rating settings change and the history is worth
-- throwing away rather than replaying: past results were rated under the old
-- settings, so leaving them in place would mix two different scales in one
-- table. Safe to run more than once.

-- 1. Bring the column default in line with STARTING_ELO. Only affects players
--    added from here on, which is why step 4 exists for the ones already there.
alter table players alter column elo set default 100;

-- 2. Add the floor from MIN_ELO to a database created before it existed.
--    Dropped first so re-running this doesn't error on the existing constraint.
alter table players drop constraint if exists players_elo_non_negative;
alter table players add  constraint players_elo_non_negative check (elo >= 0);

-- 3. Drop every grand prix. gp_results goes with it (on delete cascade).
delete from grand_prix;

-- 4. Put every character back to a clean slate. Names, ids, and created_at are
--    untouched, so the roster and any links to it survive.
update players set elo = 100, gp_count = 0;

-- Afterwards the Leaderboard and Analytics pages should both show their empty
-- states — every character sits at gp_count = 0, and `player_stats` only
-- includes players with at least one GP.
