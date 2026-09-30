/**
 * supabase.js – Verbindung zum Server: Client laden, anonym anmelden,
 * Serverfehler in verständliche deutsche Meldungen übersetzen.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/**
 * supabase-js als einzelne Datei vom CDN, feste Version mit Integritätsprüfung (SRI):
 * Der Browser führt die Datei nur aus, wenn sie Byte für Byte der geprüften Version entspricht.
 * Bei einem Versionswechsel muss der Hash mitgeändert werden (siehe README).
 */
export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const SUPABASE_JS_INTEGRITY = 'sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';

/** Fehler bei der Kommunikation mit dem Server. `offline` = keine Verbindung. */
export class ServerError extends Error {
  constructor(message, { offline = false, code = null } = {}) {
    super(message);
    this.name = 'ServerError';
    this.offline = offline;
    this.code = code;
  }
}

/**
 * Projektadresse ohne Pfad. Im Dashboard steht oft der API-Endpunkt
 * („…supabase.co/rest/v1/“) – supabase-js braucht aber nur „…supabase.co“.
 */
export function projectUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/(rest|auth|storage|realtime)\/v1(\/.*)?$/, '')
    .replace(/\/+$/, '');
}

export function isServerConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

const NETWORK_PATTERN = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i;

const SCHEMA_HINT = 'Das Datenbankschema fehlt oder ist veraltet. Bitte supabase/schema.sql im SQL Editor ausführen.';

const OWN_MESSAGE_CODES = ['P0002', '22023', '54000', '28000', '23505', '42501'];
const POSTGRES_TEXT_PATTERN = /permission denied|row-level security|duplicate key|violates/i;

/** Meldungen des Bildspeichers (Supabase Storage) für die Karte. */
const STORAGE_MESSAGES = [
  {
    pattern: /bucket not found/i,
    text: 'Der Speicher für Kartenbilder fehlt. Bitte supabase/schema.sql im SQL Editor erneut ausführen.',
  },
  {
    pattern: /exceeded the maximum allowed size|payload too large|entity too large/i,
    text: 'Das Bild ist zu groß (höchstens 5 MB).',
  },
  {
    pattern: /mime type|invalid_mime/i,
    text: 'Dieses Dateiformat ist nicht erlaubt. Bitte JPG, PNG oder WebP verwenden.',
  },
  { pattern: /object not found/i, text: 'Bild nicht gefunden – es wurde vermutlich gelöscht.' },
];

/** Übersetzt Fehler von supabase-js, fetch oder dem Laden von supabase-js in eine ServerError. */
export function toServerError(error) {
  if (error instanceof ServerError) return error;
  const message = String(error?.message ?? error ?? '');
  const code = error?.code ?? null;

  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || NETWORK_PATTERN.test(message)) {
    return new ServerError(
      'Keine Verbindung zum Server. Änderungen werden gespeichert, sobald du wieder online bist.',
      {
        offline: true,
      },
    );
  }
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return new ServerError(
      'Anonyme Anmeldung ist im Supabase-Projekt ausgeschaltet. Bitte unter Authentication → Sign In / Providers „Allow anonymous sign-ins“ aktivieren.',
      { code },
    );
  }
  if (/invalid api key|no api key/i.test(message)) {
    return new ServerError('Der Supabase-Schlüssel in js/config.js ist ungültig.', { code });
  }
  // Funktion, Tabelle oder Spalte fehlt: Nach einem App-Update wurde schema.sql noch nicht erneut ausgeführt.
  if (
    ['PGRST202', 'PGRST204', '42P01', '42883', '42703'].includes(code) ||
    /could not find the (function|'?\w+'? column)/i.test(message)
  ) {
    return new ServerError(SCHEMA_HINT, { code });
  }
  // Eigene Meldungen aus schema.sql sind bereits deutsch und verständlich (anders als die englischen von Postgres).
  if (OWN_MESSAGE_CODES.includes(code) && message && !POSTGRES_TEXT_PATTERN.test(message)) {
    return new ServerError(message, { code });
  }
  const storageProblem = STORAGE_MESSAGES.find(({ pattern }) => pattern.test(message));
  if (storageProblem) return new ServerError(storageProblem.text, { code });
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return new ServerError('Dafür fehlt dir die Berechtigung (nur eigener Held bzw. nur für den Meister).', { code });
  }
  if (code === '23505' && /duplicate key/i.test(message)) {
    return new ServerError('Das gibt es schon – du hast in diesem Raum bereits einen Helden.', { code });
  }
  return new ServerError(`Serverfehler: ${message || 'unbekannt'}`, { code });
}

/** Wartet auf eine supabase-js-Antwort { data, error } und wirft bei Fehlern eine ServerError. */
export async function unwrap(request) {
  let response;
  try {
    response = await request;
  } catch (error) {
    throw toServerError(error);
  }
  if (response.error) throw toServerError(response.error);
  return response.data;
}

/**
 * Lädt supabase-js als klassisches Skript. Anders als ein ES-Modul lässt sich das nach einem
 * Fehlschlag (z. B. offline) erneut versuchen, ohne die Seite neu zu laden.
 */
function loadSupabaseScript() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SUPABASE_JS_URL;
    script.integrity = SUPABASE_JS_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(globalThis.supabase);
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to fetch supabase-js'));
    };
    document.head.append(script);
  });
}

let clientPromise = null;

/** Lädt supabase-js (einmalig) und erzeugt den Client. */
export function getClient() {
  if (!isServerConfigured()) {
    return Promise.reject(new ServerError('Der Server ist noch nicht eingerichtet (js/config.js).'));
  }
  clientPromise ??= loadSupabaseScript()
    .then(({ createClient }) =>
      createClient(projectUrl(SUPABASE_URL), SUPABASE_ANON_KEY.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'dsa5.anmeldung' },
      }),
    )
    .catch((error) => {
      clientPromise = null; // beim nächsten Versuch erneut laden
      throw toServerError(error);
    });
  return clientPromise;
}

/** Stellt eine (anonyme) Anmeldung sicher und liefert die Nutzer-ID dieses Geräts. */
export async function ensureUser() {
  const client = await getClient();
  const { session } = await unwrap(client.auth.getSession());
  if (session?.user) return session.user.id;
  const { user } = await unwrap(client.auth.signInAnonymously());
  return user.id;
}
