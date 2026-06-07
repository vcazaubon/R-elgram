\set ON_ERROR_STOP on
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Applique la migration réelle
\i :migration

-- Rôle non-propriétaire pour FORCER l'application des RLS
create role app_user nologin;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- TEST 1 : trigger -> 6 catégories
do $$
declare uid_a uuid;
begin
  insert into auth.users (email) values ('a@test.io') returning id into uid_a;
  if (select count(*) from public.categories where user_id = uid_a) <> 6 then
    raise exception 'TRIGGER FAIL: attendu 6 categories, obtenu %',
      (select count(*) from public.categories where user_id = uid_a);
  end if;
  raise notice 'TEST1 OK: 6 categories creees par le trigger';
end $$;

-- TEST 2 : isolation RLS
do $$
declare uid_a uuid; uid_b uuid;
begin
  select id into uid_a from auth.users where email='a@test.io';
  insert into auth.users (email) values ('b@test.io') returning id into uid_b;
  insert into public.videos (user_id, source_url) values (uid_a, 'https://instagram.com/reel/a');
  insert into public.videos (user_id, source_url) values (uid_b, 'https://instagram.com/reel/b');
  perform set_config('app.test_uid_a', uid_a::text, false);
  perform set_config('app.test_uid_b', uid_b::text, false);
end $$;

set role app_user;
select set_config('app.user_id', current_setting('app.test_uid_a'), false);
do $$
begin
  if (select count(*) from public.videos) <> 1 then
    raise exception 'RLS FAIL (A): attendu 1, obtenu %', (select count(*) from public.videos);
  end if;
  raise notice 'TEST2a OK: user A ne voit que sa video';
end $$;
select set_config('app.user_id', current_setting('app.test_uid_b'), false);
do $$
begin
  if (select count(*) from public.videos) <> 1 then
    raise exception 'RLS FAIL (B): attendu 1, obtenu %', (select count(*) from public.videos);
  end if;
  raise notice 'TEST2b OK: user B ne voit que sa video';
end $$;
reset role;

-- TEST 3 : RLS activee sur les 3 tables
do $$
declare n int;
begin
  select count(*) into n from pg_tables
   where schemaname='public' and tablename in ('categories','videos','api_tokens') and rowsecurity=true;
  if n <> 3 then raise exception 'RLS FAIL: % tables avec RLS (attendu 3)', n; end if;
  raise notice 'TEST3 OK: RLS activee sur 3 tables';
end $$;

select 'ALL SCHEMA TESTS PASSED' as result;
