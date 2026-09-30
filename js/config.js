/**
 * config.js – Verbindung zu eurem Supabase-Projekt.
 *
 * Beide Werte stehen im Supabase-Dashboard unter „Project Settings → API“
 * (bzw. „Connect“). Hier gehört NUR der öffentliche anon-Key hin – niemals der
 * geheime service_role-Key. Der anon-Key darf öffentlich sein, weil die
 * Zugriffsregeln (Row Level Security in supabase/schema.sql) alles absichern.
 *
 * Solange beide Werte leer sind, läuft die App nur im Modus „Ohne Raum spielen“.
 */
export const SUPABASE_URL = ''; // z. B. 'https://abcdefghijklm.supabase.co'
export const SUPABASE_ANON_KEY = ''; // beginnt meist mit 'eyJ…' bzw. 'sb_publishable_…'
