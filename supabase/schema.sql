-- =============================================================================
-- DSA5 am Spieltisch – Datenbankschema für Supabase
--
-- Ausführen: Supabase-Dashboard → SQL Editor → „New query“ → dieses Skript
-- komplett einfügen → „Run“. Das Skript darf mehrfach ausgeführt werden.
--
-- Rollen:
--   Meister  – sieht und bearbeitet alle Helden des Raums, sieht alle Würfe,
--              führt den Kampf (Initiative), kann das Protokoll leeren,
--              verwaltet Karten und Figuren, speichert Figuren als Vorlagen und markiert
--              Stellen auf der Karte (Ping).
--   Spieler  – sieht und bearbeitet nur den eigenen Helden, sieht öffentliche Würfe
--              und eigene „nur Meister“-Würfe (verdeckte Würfe sieht nur der Meister),
--              sieht die gezeigte Karte, stellt die Figur des eigenen Helden auf und bewegt sie.
-- Anmeldung: anonym (Supabase „Anonymous Sign-ins“), keine E-Mail nötig.
-- Meister wird, wer den Raum erstellt oder beim Beitreten „Ich bin Meister“ wählt
-- (ohne PIN – die Gruppe vertraut sich; den Raumcode kennt ohnehin nur die Gruppe).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Privates Schema: wird nicht über die API veröffentlicht (Hilfsfunktionen).
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
-- Zuletzt markierte Stelle auf der Karte (Ping des Meisters): { id, map_id, x, y }.
-- Geht live an alle Geräte; nur neue Pings werden dort kurz angezeigt.
alter table public.rooms add column if not exists ping jsonb
  check (ping is null or (jsonb_typeof(ping) = 'object' and pg_column_size(ping) < 1000));

-- Frühere Versionen hatten eine Meister-PIN – die gespeicherten PINs werden nicht mehr gebraucht.
drop table if exists private.pin_attempts;
drop table if exists private.room_pins;

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

-- Karten (Bild liegt im Speicher „karten“, siehe unten). Das Raster wird als JSON gespeichert:
-- { show, size, offsetX, offsetY, color }. `revision` zählt Änderungen, die Spieler nicht
-- direkt mitbekommen (Figur verborgen oder gelöscht) – dann laden alle die Figuren neu.
create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  image_path text not null check (char_length(image_path) <= 200),
  width integer not null check (width between 1 and 10000),
  height integer not null check (height between 1 and 10000),
  grid jsonb not null default '{}'::jsonb check (jsonb_typeof(grid) = 'object' and pg_column_size(grid) < 2000),
  revision integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists maps_room on public.maps (room_id);

-- Karte, die gerade alle sehen (null = keine). Nur der Meister ändert sie.
alter table public.rooms add column if not exists active_map_id uuid references public.maps (id) on delete set null;

-- Figuren auf einer Karte. x/y = Mittelpunkt in Bildpunkten der Karte, size in Feldern.
create table if not exists public.tokens (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  map_id uuid not null references public.maps (id) on delete cascade,
  character_id uuid references public.characters (id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  image_path text check (image_path is null or char_length(image_path) <= 200),
  color text not null default 'rot' check (color in ('rot', 'blau', 'gruen', 'gelb', 'lila', 'grau')),
  size real not null default 1 check (size in (0.5, 1, 2, 3, 4)),
  x double precision not null default 0 check (x between 0 and 10000),
  y double precision not null default 0 check (y between 0 and 10000),
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Lebensenergie von Gegnern und NSC (Helden haben ihre LeP im Heldenbogen). Leer = nicht erfasst.
alter table public.tokens add column if not exists le_current integer
  check (le_current is null or le_current between -999 and 9999);
alter table public.tokens add column if not exists le_max integer
  check (le_max is null or le_max between 0 and 9999);
create index if not exists tokens_map on public.tokens (map_id);
create index if not exists tokens_room on public.tokens (room_id);

-- Gespeicherte Figuren des Meisters (Vorlagen): einmal anlegen, später wieder aufstellen.
-- Sie gehören zum Raum (der Kampagne); nur der Meister sieht sie – keine Vorschau auf Gegner.
-- Der Name ist je Raum eindeutig (ohne Groß/klein): erneut speichern aktualisiert die Vorlage.
create table if not exists public.figure_templates (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  image_path text check (image_path is null or char_length(image_path) <= 200),
  color text not null default 'rot' check (color in ('rot', 'blau', 'gruen', 'gelb', 'lila', 'grau')),
  size real not null default 1 check (size in (0.5, 1, 2, 3, 4)),
  le_max integer check (le_max is null or le_max between 0 and 9999),
  ini_base integer check (ini_base is null or ini_base between 0 and 99),
  updated_at timestamptz not null default now()
);
create unique index if not exists figure_templates_name on public.figure_templates (room_id, lower(name));

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

-- Frühere Fassungen (mit Meister-PIN) entfernen, damit es keine zwei Varianten gibt.
drop function if exists public.claim_master(text, text, text);
drop function if exists public.create_room(text, text, text);
drop function if exists public.join_room(text, text);

-- Raum erstellen: Die aufrufende Person wird Meister.
create or replace function public.create_room(p_room_name text, p_display_name text)
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

  insert into public.room_members (room_id, user_id, display_name, role)
  values (v_room, v_user, v_display, 'master');

  return query select v_room, v_code, v_room_name, 'master'::text;
end;
$$;

-- Raum beitreten: als Spieler (wer schon Meister ist, bleibt es) oder mit
-- p_as_master = true als Meister („Ich bin Meister“, z. B. auf einem zweiten Gerät).
create or replace function public.join_room(p_code text, p_display_name text, p_as_master boolean default false)
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
  values (v_room, v_user, v_display, case when coalesce(p_as_master, false) then 'master' else 'player' end)
  on conflict (room_id, user_id) do update
    set display_name = excluded.display_name,
        role = case when coalesce(p_as_master, false) then 'master' else public.room_members.role end;

  return query
    select r.id, r.code, r.name, m.role
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_user
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
-- Karte
-- -----------------------------------------------------------------------------

-- Ist diese Karte gerade für alle gezeigt? (Spieler sehen nur sie und ihre Figuren.)
-- Prüft nur den Raum – so funktioniert die Regel auch für gerade eingefügte Zeilen.
create or replace function public.is_active_map(p_room_id uuid, p_map_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rooms r where r.id = p_room_id and r.active_map_id = p_map_id);
$$;

-- Bilder liegen im Speicher unter „<Raum-ID>/<Datei>“. Liefert die Raum-ID oder null.
create or replace function public.room_of_path(p_path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(coalesce(p_path, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_path, '/', 1)::uuid
  end;
$$;

-- Die gezeigte Karte muss zum Raum gehören.
create or replace function private.check_active_map()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_map_id is not null
    and not exists (select 1 from public.maps m where m.id = new.active_map_id and m.room_id = new.id) then
    raise exception 'Diese Karte gehört nicht zu diesem Raum.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_check_active_map on public.rooms;
create trigger rooms_check_active_map
  before update of active_map_id on public.rooms
  for each row execute function private.check_active_map();

create or replace function private.touch_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tokens_touch on public.tokens;
create trigger tokens_touch
  before update on public.tokens
  for each row execute function private.touch_token();

-- Verbirgt oder löscht der Meister eine Figur, erfahren Spieler das nicht direkt
-- (sie dürfen die Zeile nicht mehr sehen). Deshalb zählt die Karte dann hoch.
create or replace function private.bump_map_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.maps set revision = revision + 1 where id = old.map_id;
  else
    update public.maps set revision = revision + 1 where id = new.map_id;
  end if;
  return null;
end;
$$;

drop trigger if exists tokens_bump_on_delete on public.tokens;
create trigger tokens_bump_on_delete
  after delete on public.tokens
  for each row execute function private.bump_map_revision();

drop trigger if exists tokens_bump_on_hide on public.tokens;
create trigger tokens_bump_on_hide
  after update of hidden on public.tokens
  for each row when (old.hidden is distinct from new.hidden)
  execute function private.bump_map_revision();

-- Lebensbalken der Helden: Die LeP eines Helden werden auf seine Figuren gespiegelt. So sehen alle
-- im Raum die Balken der Gruppe, ohne fremde Heldenbögen lesen zu dürfen. Unlesbare Werte werden
-- zu „leer“ – ein Fehler hier darf das Speichern des Helden nie verhindern.
create or replace function private.hero_life(p_data jsonb, p_key text, p_min integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_data -> 'base' -> 'le' ->> p_key) ~ '^\s*-?\d{1,9}(\.\d+)?\s*$'
      then least(greatest(round(btrim(p_data -> 'base' -> 'le' ->> p_key)::numeric), p_min), 9999)::integer
  end;
$$;

create or replace function private.mirror_hero_life()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer := private.hero_life(new.data, 'current', -999);
  v_max integer := private.hero_life(new.data, 'max', 0);
begin
  update public.tokens t
  set le_current = v_current, le_max = v_max
  where t.character_id = new.id
    and (t.le_current is distinct from v_current or t.le_max is distinct from v_max);
  return null;
end;
$$;

drop trigger if exists characters_mirror_life on public.characters;
create trigger characters_mirror_life
  after update of data on public.characters
  for each row execute function private.mirror_hero_life();

-- Neue oder umgehängte Heldenfigur: LeP gleich aus dem Heldenbogen übernehmen.
create or replace function private.token_hero_life()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
begin
  if new.character_id is not null then
    select c.data into v_data from public.characters c where c.id = new.character_id;
    new.le_current := private.hero_life(v_data, 'current', -999);
    new.le_max := private.hero_life(v_data, 'max', 0);
  end if;
  return new;
end;
$$;

drop trigger if exists tokens_hero_life on public.tokens;
create trigger tokens_hero_life
  before insert or update of character_id on public.tokens
  for each row execute function private.token_hero_life();

-- Figuren, die vor dieser Funktion aufgestellt wurden, einmal nachtragen.
update public.tokens t
set le_current = private.hero_life(c.data, 'current', -999),
    le_max = private.hero_life(c.data, 'max', 0)
from public.characters c
where c.id = t.character_id
  and (
    t.le_current is distinct from private.hero_life(c.data, 'current', -999)
    or t.le_max is distinct from private.hero_life(c.data, 'max', 0)
  );

-- Figur bewegen: Meister jede, Spieler nur die Figur des eigenen Helden (wenn sichtbar).
-- Die Position wird auf die Karte begrenzt.
create or replace function public.move_token(p_token_id uuid, p_x double precision, p_y double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.tokens;
  v_map public.maps;
begin
  perform private.require_user();
  select * into v_token from public.tokens t where t.id = p_token_id;
  if v_token.id is null then
    raise exception 'Diese Figur gibt es nicht mehr.' using errcode = 'P0002';
  end if;
  if not public.is_room_master(v_token.room_id) and not (
    not v_token.hidden
    and public.is_room_member(v_token.room_id)
    and public.is_active_map(v_token.room_id, v_token.map_id)
    and exists (
      select 1 from public.characters c
      where c.id = v_token.character_id and c.owner_id = (select auth.uid())
    )
  ) then
    raise exception 'Du kannst nur die Figur deines eigenen Helden bewegen.' using errcode = '42501';
  end if;
  select * into v_map from public.maps m where m.id = v_token.map_id;
  update public.tokens
  set x = least(greatest(coalesce(p_x, 0), 0), v_map.width),
      y = least(greatest(coalesce(p_y, 0), 0), v_map.height)
  where id = p_token_id;
end;
$$;

-- Spieler: die Figur des eigenen Helden selbst auf die gezeigte Karte stellen (einmal je Karte).
-- Ohne eigenes Bild wird das Bild der letzten Figur dieses Helden übernommen. Der Meister darf
-- das auch auf vorbereiteten Karten. Name und LeP kommen aus dem Heldenbogen.
create or replace function public.place_own_token(
  p_map_id uuid,
  p_x double precision,
  p_y double precision,
  p_color text default null,
  p_image_path text default null
)
returns setof public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.maps;
  v_character public.characters;
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_color text := coalesce(nullif(p_color, ''), 'blau');
begin
  perform private.require_user();
  select * into v_map from public.maps m where m.id = p_map_id;
  if v_map.id is null or not public.is_room_member(v_map.room_id) then
    raise exception 'Diese Karte gibt es nicht (mehr).' using errcode = 'P0002';
  end if;
  if not public.is_room_master(v_map.room_id) and not public.is_active_map(v_map.room_id, v_map.id) then
    raise exception 'Deine Figur kannst du nur auf die Karte stellen, die der Meister gerade zeigt.'
      using errcode = '42501';
  end if;
  if v_color not in ('rot', 'blau', 'gruen', 'gelb', 'lila', 'grau') then
    raise exception 'Unbekannte Farbe.' using errcode = '22023';
  end if;
  if v_image is not null and public.room_of_path(v_image) is distinct from v_map.room_id then
    raise exception 'Dieses Bild gehört nicht zu diesem Raum.' using errcode = '22023';
  end if;
  select * into v_character from public.characters c
  where c.room_id = v_map.room_id and c.owner_id = (select auth.uid());
  if v_character.id is null then
    raise exception 'Lege zuerst deinen Helden an (Tab „Held“).' using errcode = '22023';
  end if;
  if exists (select 1 from public.tokens t where t.map_id = v_map.id and t.character_id = v_character.id) then
    raise exception 'Deine Figur steht schon auf dieser Karte (vielleicht hat der Meister sie gerade verborgen).'
      using errcode = '23505';
  end if;
  if v_image is null then
    select t.image_path into v_image from public.tokens t
    where t.character_id = v_character.id and t.image_path is not null
    order by t.updated_at desc limit 1;
  end if;
  return query
    insert into public.tokens (room_id, map_id, character_id, name, image_path, color, size, x, y, hidden)
    values (
      v_map.room_id,
      v_map.id,
      v_character.id,
      left(coalesce(nullif(btrim(v_character.data -> 'general' ->> 'name'), ''), 'Held'), 40),
      v_image,
      v_color,
      1,
      least(greatest(coalesce(p_x, 0), 0), v_map.width),
      least(greatest(coalesce(p_y, 0), 0), v_map.height),
      false
    )
    returning *;
end;
$$;

-- Meister: Welche dieser Bilder benutzt keine Karte und keine Figur mehr?
-- (Danach löscht die App sie aus dem Speicher.)
create or replace function public.unused_images(p_room_id uuid, p_paths text[])
returns table (path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_user();
  if not public.is_room_master(p_room_id) then
    raise exception 'Nur der Meister kann Bilder aufräumen.' using errcode = '42501';
  end if;
  return query
    select distinct p.path
    from unnest(coalesce(p_paths, '{}'::text[])) as p (path)
    where public.room_of_path(p.path) = p_room_id
      and not exists (select 1 from public.maps m where m.image_path = p.path)
      and not exists (select 1 from public.tokens t where t.image_path = p.path)
      and not exists (select 1 from public.figure_templates f where f.image_path = p.path);
end;
$$;

-- Meister: Figur als Vorlage speichern. Gibt es den Namen im Raum schon, wird sie aktualisiert.
create or replace function public.save_figure_template(
  p_room_id uuid,
  p_name text,
  p_color text default 'rot',
  p_size real default 1,
  p_le_max integer default null,
  p_ini_base integer default null,
  p_image_path text default null
)
returns setof public.figure_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_user();
  if not public.is_room_master(p_room_id) then
    raise exception 'Nur der Meister kann Figuren speichern.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Bitte einen Namen eingeben.' using errcode = '22023';
  end if;
  if p_image_path is not null and public.room_of_path(p_image_path) is distinct from p_room_id then
    raise exception 'Das Bild gehört nicht zu diesem Raum.' using errcode = '42501';
  end if;
  if (select count(*) from public.figure_templates f where f.room_id = p_room_id) >= 200
    and not exists (
      select 1 from public.figure_templates f where f.room_id = p_room_id and lower(f.name) = lower(v_name)
    ) then
    raise exception 'Höchstens 200 gespeicherte Figuren je Raum – bitte alte löschen.' using errcode = '54000';
  end if;
  return query
    insert into public.figure_templates as f (room_id, name, color, size, le_max, ini_base, image_path)
    values (p_room_id, v_name, coalesce(p_color, 'rot'), coalesce(p_size, 1), p_le_max, p_ini_base, p_image_path)
    on conflict (room_id, (lower(name))) do update
      set name = excluded.name,
          color = excluded.color,
          size = excluded.size,
          le_max = excluded.le_max,
          ini_base = excluded.ini_base,
          image_path = excluded.image_path,
          updated_at = now()
    returning f.*;
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

-- Der Meister führt den Kampf, zeigt Karten und markiert Stellen (Spalten siehe Rechte unten).
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

-- Karten: Meister alle (auch zur Vorbereitung), Spieler nur die gezeigte. Ändern nur der Meister.
alter table public.maps enable row level security;
alter table public.tokens enable row level security;
alter table public.figure_templates enable row level security;

drop policy if exists "Karten sehen" on public.maps;
create policy "Karten sehen" on public.maps
  for select to authenticated
  using (
    public.is_room_master(room_id)
    or (public.is_room_member(room_id) and public.is_active_map(room_id, id))
  );

drop policy if exists "Meister legt Karten an" on public.maps;
create policy "Meister legt Karten an" on public.maps
  for insert to authenticated
  with check (public.is_room_master(room_id) and public.room_of_path(image_path) = room_id);

drop policy if exists "Meister bearbeitet Karten" on public.maps;
create policy "Meister bearbeitet Karten" on public.maps
  for update to authenticated
  using (public.is_room_master(room_id))
  with check (public.is_room_master(room_id));

drop policy if exists "Meister löscht Karten" on public.maps;
create policy "Meister löscht Karten" on public.maps
  for delete to authenticated
  using (public.is_room_master(room_id));

-- Figuren: sichtbar auf sichtbaren Karten; verborgene Figuren nur für den Meister.
-- Bewegen geht für Spieler nur über move_token() (eigener Held).
drop policy if exists "Figuren sehen" on public.tokens;
create policy "Figuren sehen" on public.tokens
  for select to authenticated
  using (
    public.is_room_master(room_id)
    or (not hidden and public.is_room_member(room_id) and public.is_active_map(room_id, map_id))
  );

drop policy if exists "Meister stellt Figuren auf" on public.tokens;
create policy "Meister stellt Figuren auf" on public.tokens
  for insert to authenticated
  with check (
    public.is_room_master(room_id)
    and exists (select 1 from public.maps m where m.id = map_id and m.room_id = tokens.room_id)
    and (
      character_id is null
      or exists (select 1 from public.characters c where c.id = character_id and c.room_id = tokens.room_id)
    )
    and (image_path is null or public.room_of_path(image_path) = room_id)
  );

drop policy if exists "Meister bearbeitet Figuren" on public.tokens;
create policy "Meister bearbeitet Figuren" on public.tokens
  for update to authenticated
  using (public.is_room_master(room_id))
  with check (
    public.is_room_master(room_id)
    and (
      character_id is null
      or exists (select 1 from public.characters c where c.id = character_id and c.room_id = tokens.room_id)
    )
    and (image_path is null or public.room_of_path(image_path) = room_id)
  );

drop policy if exists "Meister entfernt Figuren" on public.tokens;
create policy "Meister entfernt Figuren" on public.tokens
  for delete to authenticated
  using (public.is_room_master(room_id));

-- Gespeicherte Figuren: nur der Meister (Anlegen und Ändern über save_figure_template()).
drop policy if exists "Meister sieht gespeicherte Figuren" on public.figure_templates;
create policy "Meister sieht gespeicherte Figuren" on public.figure_templates
  for select to authenticated
  using (public.is_room_master(room_id));

drop policy if exists "Meister löscht gespeicherte Figuren" on public.figure_templates;
create policy "Meister löscht gespeicherte Figuren" on public.figure_templates
  for delete to authenticated
  using (public.is_room_master(room_id));

-- -----------------------------------------------------------------------------
-- Rechte: nur angemeldete (auch anonyme) Nutzer, nur die nötigen Spalten.
-- -----------------------------------------------------------------------------

revoke all on public.rooms, public.room_members, public.characters, public.rolls from anon, authenticated;
revoke all on public.maps, public.tokens, public.figure_templates from anon, authenticated;

grant select on public.rooms to authenticated;
grant update (combat, active_map_id, ping) on public.rooms to authenticated;
grant select, delete on public.maps to authenticated;
grant insert (id, room_id, name, image_path, width, height, grid) on public.maps to authenticated;
grant update (name, grid) on public.maps to authenticated;
grant select, delete on public.tokens to authenticated;
grant insert (id, room_id, map_id, character_id, name, image_path, color, size, x, y, hidden, le_current, le_max)
  on public.tokens to authenticated;
grant update (character_id, name, image_path, color, size, x, y, hidden, le_current, le_max)
  on public.tokens to authenticated;
grant select, delete on public.figure_templates to authenticated;
grant select, delete on public.room_members to authenticated;
grant select, delete on public.characters to authenticated;
grant insert (room_id, data) on public.characters to authenticated;
grant update (data) on public.characters to authenticated;
grant select, delete on public.rolls to authenticated;
grant insert (id, room_id, character_id, actor, visibility, data) on public.rolls to authenticated;

revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.is_room_master(uuid) from public, anon;
revoke all on function public.create_room(text, text) from public, anon;
revoke all on function public.join_room(text, text, boolean) from public, anon;
revoke all on function public.assign_character(uuid, uuid) from public, anon;
revoke all on function public.clear_log(uuid) from public, anon;
revoke all on function public.is_active_map(uuid, uuid) from public, anon;
revoke all on function public.room_of_path(text) from public, anon;
revoke all on function public.move_token(uuid, double precision, double precision) from public, anon;
revoke all on function public.unused_images(uuid, text[]) from public, anon;
revoke all on function public.place_own_token(uuid, double precision, double precision, text, text) from public, anon;
revoke all on function public.save_figure_template(uuid, text, text, real, integer, integer, text) from public, anon;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_master(uuid) to authenticated;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(text, text, boolean) to authenticated;
grant execute on function public.assign_character(uuid, uuid) to authenticated;
grant execute on function public.clear_log(uuid) to authenticated;
grant execute on function public.is_active_map(uuid, uuid) to authenticated;
grant execute on function public.room_of_path(text) to authenticated;
grant execute on function public.move_token(uuid, double precision, double precision) to authenticated;
grant execute on function public.unused_images(uuid, text[]) to authenticated;
grant execute on function public.place_own_token(uuid, double precision, double precision, text, text) to authenticated;
grant execute on function public.save_figure_template(uuid, text, text, real, integer, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Speicher für Kartenbilder und Figurenbilder (Supabase Storage, nicht öffentlich)
-- Pfad: „<Raum-ID>/<Datei>“. Sehen und hochladen: alle im Raum (Spieler: Bild ihrer eigenen
-- Figur). Löschen: nur der Meister (die App räumt nicht mehr benutzte Bilder auf).
-- Höchstens 5 MB je Bild; die App verkleinert Bilder vor dem Hochladen.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('karten', 'karten', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Kartenbilder sehen" on storage.objects;
create policy "Kartenbilder sehen" on storage.objects
  for select to authenticated
  using (bucket_id = 'karten' and public.is_room_member(public.room_of_path(name)));

drop policy if exists "Kartenbilder hochladen" on storage.objects;
create policy "Kartenbilder hochladen" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'karten' and public.is_room_member(public.room_of_path(name)));

drop policy if exists "Kartenbilder löschen" on storage.objects;
create policy "Kartenbilder löschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'karten' and public.is_room_master(public.room_of_path(name)));

-- -----------------------------------------------------------------------------
-- Realtime: Änderungen an Helden, Mitgliedern, Würfen, Kampf und Karte live verteilen.
-- Die Zugriffsregeln oben gelten auch für Realtime.
-- -----------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['rooms', 'characters', 'room_members', 'rolls', 'maps', 'tokens'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception when duplicate_object then
      null; -- Tabelle ist schon eingetragen
    end;
  end loop;
end;
$$;

-- Stand dieses Skripts. Die App prüft ihn beim Start und sagt genau, was zu tun ist (Skript
-- erneut ausführen bzw. Seite neu laden). Bei jeder Änderung am Schema hochzählen – zusammen
-- mit SCHEMA_VERSION in js/supabase.js.
create or replace function public.schema_version()
returns table (version integer)
language sql
stable
set search_path = ''
as $$
  select 4;
$$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;

-- Die Supabase-API (PostgREST) soll neue Funktionen und Spalten sofort kennen – nicht erst,
-- wenn sie ihren Zwischenspeicher von selbst erneuert.
notify pgrst, 'reload schema';
