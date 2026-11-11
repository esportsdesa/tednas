-- Tiruan bagian Supabase yang dipakai skema TEDNas, untuk menguji SQL di Postgres biasa (uji/uji-sql.mjs).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public to anon, authenticated;
-- Seperti Supabase: anon/authenticated mendapat hak bawaan atas objek baru di public; RLS & revoke skema yang membatasi.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('uji.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

create schema extensions;
create extension pgcrypto with schema extensions;
create function extensions.urlencode(text) returns text language sql immutable as $$ select $1 $$;
-- Turnstile tiruan: token "lulus" sah, selain itu gagal.
create function extensions.http_post(url text, body text, ctype text, out status int, out content text) language sql as $$
  select 200, case when body like '%response=lulus' then '{"success":true}' else '{"success":false}' end $$;
grant usage on schema extensions to anon, authenticated;

-- pg_net tiruan: permintaan dicatat, tidak dikirim.
create schema net;
create table net._kirim (id bigserial primary key, url text, body jsonb, headers jsonb, waktu timestamptz default clock_timestamp());
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net._kirim (url, body, headers) values (url, body, headers) returning id $$;
