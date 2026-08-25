-- Not a versioned migration — this is a template, run manually in the
-- SQL Editor whenever setting or changing the shared site password.
-- Replace REPLACE_WITH_YOUR_PASSWORD with the actual password before
-- running. Never commit this file with a real password filled in —
-- keep the placeholder here, type the real value only in the SQL Editor.
-- The `on conflict` makes this an upsert, so re-running it with a new
-- value is also how you change the password later.

insert into site_secret (id, password_hash)
values (1, crypt('REPLACE_WITH_YOUR_PASSWORD', gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;
