-- =============================================================================
-- DSA5 am Spieltisch – Datenbankschema für Supabase
--
-- Ausführen: Supabase-Dashboard → SQL Editor → „New query“ → dieses Skript
-- komplett einfügen → „Run“. Das Skript darf mehrfach ausgeführt werden.
--
-- Rollen:
--   Meister  – sieht und bearbeitet alle Helden des Raums, sieht alle Würfe,
--              führt den Kampf (Initiative) und kann das Protokoll leeren.
--   Spieler  – sieht und bearbeitet nur den eigenen Helden, sieht öffentliche Würfe
--              und eigene „nur Meister“-Würfe (verdeckte Würfe sieht nur der Meister).
-- Anmeldung: anonym (Supabase „Anonymous Sign-ins“), keine E-Mail nötig.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Privates Schema: wird nicht über die API veröffentlicht. Nur die Funktionen
-- unten greifen darauf zu (Meister-PIN, Fehlversuche).
create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Tabellen
-- -----------------------------------------------------------------------------

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null default '' check (char_length(name) <= 60),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Laufender Kampf (Initiative-Reihenfolge, wer ist dran) – nur der Meister ändert ihn.
alter table public.rooms add column if not exists combat jsonb
  check (combat is null or (jsonb_typeof(combat) = 'object' and pg_column_size(combat) < 200000));
-- Zeitpunkt, zu dem der Meister das Protokoll zuletzt geleert hat (für alle Geräte).
alter table public.rooms add column if not exists log_cleared_at timestamptz;

create table if not exists private.room_pins (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  pin_hash text not null
);

create table if not exists private.pin_attempts (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_room_time on private.pin_attempts (room_id, attempted_at);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default 'player' check (role in ('master', 'player')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (room_id, owner_id)
);
create index if not exists characters_room on public.characters (room_id);

create table if not exists public.rolls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  character_id uuid references public.characters (id) on delete set null,
  actor text not null check (char_length(actor) between 1 and 80),
  visibility text not null default 'public' check (visibility in ('public', 'master', 'secret')),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 100000),
  created_at timestamptz not null default now()
);
create index if not exists rolls_room_time on public.rolls (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Hilfsfunktionen für die Zugriffsregeln
-- (security definer, damit die Regeln sich nicht gegenseitig blockieren)
-- -----------------------------------------------------------------------------

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_room_master(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid()) and m.role = 'master'
  );
$$;

-- Zeitstempel und Bearbeiter bei jeder Änderung eines Helden setzen.
create or replace function private.touch_character()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch
  before update on public.characters
  for each row execute function private.touch_character();

-- Zufälliger, gut lesbarer Raumcode aus 32 Zeichen (ohne 0/O und 1/I).
create or replace function private.new_room_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(r.bytes, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(6) as bytes) r, generate_series(0, 5) as i;
$$;

create or replace function private.clean_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Bitte einen Namen mit 1 bis 40 Zeichen angeben.' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

create or replace function private.find_room(p_code text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_room uuid;
begin
  select r.id into v_room
  from public.rooms r
  where r.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_room is null then
    raise exception 'Kein Raum mit diesem Code gefunden. Bitte den Code prüfen.' using errcode = 'P0002';
  end if;
  return v_room;
end;
$$;

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet. Bitte die Seite neu laden.' using errcode = '28000';
  end if;
  return auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- Aufrufbare Funktionen (RPC) für Räume
-- -----------------------------------------------------------------------------

-- Raum erstellen: Die aufrufende Person wird Meister.
create or replace function public.create_room(p_room_name text, p_display_name text, p_pin text)
returns table (room_id uuid, code text, name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := private.require_user();
  v_display text := private.clean_display_name(p_display_name);
  v_room_name text := left(btrim(coalesce(p_room_name, '')), 60);
  v_room uuid;
  v_code text;
begin
  if char_length(coalesce(p_pin, '')) < 4 then
    raise exception 'Die Meister-PIN muss mindestens 4 Zeichen lang sein.' using errcode = '22023';
  end if;

  loop
    v_code := private.new_room_code();
    begin
      insert into public.rooms (code, name, created_by) values (v_code, v_room_name, v_user)
      returning id into v_room;
      exit;
    exception when unique_violation then
      -- Code schon vergeben: einen neuen ziehen.
    end;
  end loop;

  insert into private.room_pins (room_id, pin_hash)
  values (v_room, extensions.crypt(p_pin, extensions.gen_salt('bf')));

  insert into public.room_members (room_id, user_id, display_name, role)
  values (v_room, v_user, v_display, 'master');

  return query select v_room, v_code, v_room_name, 'master'::text;
end;
$$;

-- Raum als Spieler beitreten (bestehende Meister behalten ihre Rolle).
create or replace function public.join_room(p_code text, p_display_name text)
returns table (room_id uuid, code text, name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := private.require_user();
  v_display text := private.clean_display_name(p_display_name);
  v_room uuid := private.find_room(p_code);
begin
  insert into public.room_members (room_id, user_id, display_name, role)
  values (v_room, v_user, v_display, 'player')
  on conflict (room_id, user_id) do update set display_name = excluded.display_name;

  return query
    select r.id, r.code, r.name, m.role
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_user
    where r.id = v_room;
end;
$$;

-- Als Meister beitreten (PIN nötig). Falsche PIN: keine Zeile zurück.
-- Schutz vor Durchprobieren: höchstens 10 Fehlversuche je Raum in 15 Minuten.
create or replace function public.claim_master(p_code text, p_display_name text, p_pin text)
returns table (room_id uuid, code text, name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := private.require_user();
  v_display text := private.clean_display_name(p_display_name);
  v_room uuid := private.find_room(p_code);
  v_hash text;
begin
  delete from private.pin_attempts a where a.attempted_at < now() - interval '1 day';

  if (
    select count(*) from private.pin_attempts a
    where a.room_id = v_room and a.attempted_at > now() - interval '15 minutes'
  ) >= 10 then
    raise exception 'Zu viele falsche PIN-Eingaben. Bitte in 15 Minuten erneut versuchen.' using errcode = '54000';
  end if;

  select p.pin_hash into v_hash from private.room_pins p where p.room_id = v_room;
  if v_hash is null or extensions.crypt(coalesce(p_pin, ''), v_hash) <> v_hash then
    insert into private.pin_attempts (room_id) values (v_room);
    return;
  end if;

  insert into public.room_members (room_id, user_id, display_name, role)
  values (v_room, v_user, v_display, 'master')
  on conflict (room_id, user_id) do update set display_name = excluded.display_name, role = 'master';

  return query
    select r.id, r.code, r.name, 'master'::text
    from public.rooms r
    where r.id = v_room;
end;
$$;

-- Meister weist einen Helden einer Person im Raum zu (z. B. nach Gerätewechsel).
create or replace function public.assign_character(p_character_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  perform private.require_user();
  select c.room_id into v_room from public.characters c where c.id = p_character_id;
  if v_room is null or not public.is_room_master(v_room) then
    raise exception 'Nur der Meister kann Helden zuweisen.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_members m where m.room_id = v_room and m.user_id = p_user_id) then
    raise exception 'Diese Person ist nicht in diesem Raum.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.characters c
    where c.room_id = v_room and c.owner_id = p_user_id and c.id <> p_character_id
  ) then
    raise exception 'Diese Person hat in diesem Raum bereits einen Helden.' using errcode = '23505';
  end if;
  update public.characters set owner_id = p_user_id where id = p_character_id;
end;
$$;

-- Meister leert das gemeinsame Würfelprotokoll; alle Geräte erfahren es über rooms.log_cleared_at.
create or replace function public.clear_log(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not public.is_room_master(p_room_id) then
    raise exception 'Nur der Meister kann das Protokoll leeren.' using errcode = '42501';
  end if;
  delete from public.rolls r where r.room_id = p_room_id;
  update public.rooms set log_cleared_at = now() where id = p_room_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.characters enable row level security;
alter table public.rolls enable row level security;

-- Räume: nur für Mitglieder sichtbar; Anlegen nur über create_room().
drop policy if exists "Mitglieder sehen ihren Raum" on public.rooms;
create policy "Mitglieder sehen ihren Raum" on public.rooms
  for select to authenticated
  using (public.is_room_member(id));

-- Der Meister führt den Kampf (Spalte combat, siehe Rechte unten).
drop policy if exists "Meister führt den Kampf" on public.rooms;
create policy "Meister führt den Kampf" on public.rooms
  for update to authenticated
  using (public.is_room_master(id))
  with check (public.is_room_master(id));

-- Mitglieder: sehen sich gegenseitig; jeder kann den Raum verlassen.
drop policy if exists "Mitglieder sehen die Mitglieder ihres Raums" on public.room_members;
create policy "Mitglieder sehen die Mitglieder ihres Raums" on public.room_members
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Mitglieder können den Raum verlassen" on public.room_members;
create policy "Mitglieder können den Raum verlassen" on public.room_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Helden: Spieler nur den eigenen, Meister alle im Raum.
drop policy if exists "Eigenen Helden oder als Meister alle sehen" on public.characters;
create policy "Eigenen Helden oder als Meister alle sehen" on public.characters
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_room_master(room_id));

drop policy if exists "Eigenen Helden im eigenen Raum anlegen" on public.characters;
create policy "Eigenen Helden im eigenen Raum anlegen" on public.characters
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_room_member(room_id));

drop policy if exists "Eigenen Helden oder als Meister alle bearbeiten" on public.characters;
create policy "Eigenen Helden oder als Meister alle bearbeiten" on public.characters
  for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_room_master(room_id))
  with check (owner_id = (select auth.uid()) or public.is_room_master(room_id));

drop policy if exists "Eigenen Helden oder als Meister alle löschen" on public.characters;
create policy "Eigenen Helden oder als Meister alle löschen" on public.characters
  for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_room_master(room_id));

-- Würfe: öffentlich = alle im Raum; „nur Meister“ = Meister und wer gewürfelt hat;
-- „verdeckt“ = nur Meister.
drop policy if exists "Würfe je nach Sichtbarkeit sehen" on public.rolls;
create policy "Würfe je nach Sichtbarkeit sehen" on public.rolls
  for select to authenticated
  using (
    public.is_room_member(room_id)
    and (
      visibility = 'public'
      or public.is_room_master(room_id)
      or (visibility = 'master' and user_id = (select auth.uid()))
    )
  );

drop policy if exists "Im eigenen Raum würfeln" on public.rolls;
create policy "Im eigenen Raum würfeln" on public.rolls
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_room_member(room_id)
    and (
      character_id is null
      or exists (select 1 from public.characters c where c.id = character_id and c.room_id = rolls.room_id)
    )
  );

drop policy if exists "Meister kann das Protokoll leeren" on public.rolls;
create policy "Meister kann das Protokoll leeren" on public.rolls
  for delete to authenticated
  using (public.is_room_master(room_id));

-- -----------------------------------------------------------------------------
-- Rechte: nur angemeldete (auch anonyme) Nutzer, nur die nötigen Spalten.
-- -----------------------------------------------------------------------------

revoke all on public.rooms, public.room_members, public.characters, public.rolls from anon, authenticated;

grant select on public.rooms to authenticated;
grant update (combat) on public.rooms to authenticated;
grant select, delete on public.room_members to authenticated;
grant select, delete on public.characters to authenticated;
grant insert (room_id, data) on public.characters to authenticated;
grant update (data) on public.characters to authenticated;
grant select, delete on public.rolls to authenticated;
grant insert (id, room_id, character_id, actor, visibility, data) on public.rolls to authenticated;

revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.is_room_master(uuid) from public, anon;
revoke all on function public.create_room(text, text, text) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.claim_master(text, text, text) from public, anon;
revoke all on function public.assign_character(uuid, uuid) from public, anon;
revoke all on function public.clear_log(uuid) from public, anon;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_master(uuid) to authenticated;
grant execute on function public.create_room(text, text, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.claim_master(text, text, text) to authenticated;
grant execute on function public.assign_character(uuid, uuid) to authenticated;
grant execute on function public.clear_log(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: Änderungen an Helden, Mitgliedern, Würfen und am Kampf live verteilen.
-- Die Zugriffsregeln oben gelten auch für Realtime.
-- -----------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['rooms', 'characters', 'room_members', 'rolls'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception when duplicate_object then
      null; -- Tabelle ist schon eingetragen
    end;
  end loop;
end;
$$;
