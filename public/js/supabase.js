// Cliente de Supabase Auth para el frontend.
//
// La configuración (URL del proyecto y anon key) NO está hardcodeada: llega
// desde /api/config, que la lee del .env del servidor. La anon key es pública,
// por eso puede viajar al navegador; la service_role nunca sale del backend.

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let configPromise = null;
let clientPromise = null;

/** Config pública del servidor (se pide una sola vez por página). */
export function loadConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return configPromise;
}

/** Devuelve el cliente de Supabase, o null si todavía no está configurado. */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await loadConfig();
      if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
      const { createClient } = await import(CDN);
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })();
  }
  return clientPromise;
}

export async function getSession() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token ?? null;
}

/** Abre el flujo de Google. `redirectTo` es a dónde vuelve el usuario. */
export async function signInWithGoogle(redirectTo = window.location.href) {
  const supabase = await getSupabase();
  if (!supabase) {
    throw new Error('El login todavía no está configurado. Avisale al local.');
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function signOut() {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function onAuthChange(callback) {
  const supabase = await getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
