const PUBLIC_CONFIG_ENDPOINT = "/api/public-config";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let configPromise;
let clientPromise;
let authListenerAttached = false;

function isEnglish() {
  return document.documentElement.lang === "en";
}

function loginUrl(message = "", redirectTo = "") {
  const url = new URL("/login", window.location.origin);
  if (message) url.searchParams.set("message", message);
  if (redirectTo) url.searchParams.set("redirect", redirectTo);
  return url.toString();
}

function getConfiguredRedirect() {
  const params = new URLSearchParams(window.location.search);
  return params.get("redirect") || "/dashboard";
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeSupabaseUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function isLikelyPublicApiKey(value) {
  const isLegacyAnonJwt =
    value &&
    value.length > 80 &&
    value.split(".").length >= 3;
  const isPublishableKey = /^sb_publishable_[a-zA-Z0-9_-]+$/.test(value || "");

  return Boolean(
    value &&
    !/^https?:\/\//i.test(value) &&
    (isLegacyAnonJwt || isPublishableKey)
  );
}

function normalizePublicConfig(config) {
  const normalizedUrl = normalizeSupabaseUrl(config?.supabaseUrl || "");
  const validAnonKey = isLikelyPublicApiKey(config?.supabaseAnonKey || "");
  const missing = Array.isArray(config?.missing) ? [...config.missing] : [];

  if (!normalizedUrl && !missing.includes("NEXT_PUBLIC_SUPABASE_URL")) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!validAnonKey && !missing.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return {
    ...config,
    configured: missing.length === 0,
    missing,
    supabaseUrl: normalizedUrl,
    supabaseAnonKey: validAnonKey ? config.supabaseAnonKey : ""
  };
}

export async function getPublicConfig() {
  if (!configPromise) {
    configPromise = fetch(PUBLIC_CONFIG_ENDPOINT, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Configuration inaccessible (${response.status})`);
        }
        const config = await response.json();
        return normalizePublicConfig(config);
      });
  }
  return configPromise;
}

export async function getAuthContext() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = await getPublicConfig();
      if (!config.configured) {
        return { config, supabase: null };
      }
      const { createClient } = await import(SUPABASE_CDN);
      const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      return { config, supabase };
    })();
  }
  return clientPromise;
}

export function missingConfigMessage(config) {
  const missing = config?.missing?.length ? config.missing.join(", ") : "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY";
  return isEnglish()
    ? `Google login is not active yet. Check these Vercel variables: ${missing}.`
    : `La connexion Google n'est pas encore active. Vérifiez ces variables Vercel : ${missing}.`;
}

export async function getSession() {
  const { supabase } = await getAuthContext();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session || null;
}

export async function signInWithGoogle() {
  const { config, supabase } = await getAuthContext();
  if (!supabase) {
    throw new Error(missingConfigMessage(config));
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  });
  if (error) throw error;
}

export async function completeOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const providerError = params.get("error_description") || params.get("error");
  if (providerError) throw new Error(providerError);

  const code = params.get("code");
  if (!code) {
    throw new Error(isEnglish() ? "No OAuth code received." : "Aucun code OAuth reçu.");
  }

  const { config, supabase } = await getAuthContext();
  if (!supabase) {
    throw new Error(missingConfigMessage(config));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

export async function redirectIfAuthenticated() {
  const session = await getSession();
  if (session) {
    window.location.replace(getConfiguredRedirect());
  }
}

export async function requireAuth() {
  const { config, supabase } = await getAuthContext();
  if (!supabase) {
    throw new Error(missingConfigMessage(config));
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    window.location.replace(loginUrl("dashboard", window.location.pathname));
    return null;
  }
  return data.session;
}

export async function signOutToHome() {
  const { supabase } = await getAuthContext();
  if (supabase) await supabase.auth.signOut();
  window.location.href = "/";
}

function userInitial(user) {
  const name = safeText(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email, "U");
  return name.charAt(0).toUpperCase();
}

function avatarHtml(user) {
  const avatar = safeUrl(user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "");
  if (avatar) {
    return `<img class="auth-avatar" src="${escapeHtml(avatar)}" alt=""/>`;
  }
  return `<span class="auth-avatar-fallback">${escapeHtml(userInitial(user))}</span>`;
}

export async function renderAuthNav() {
  const links = document.querySelectorAll("[data-auth-nav]");
  if (!links.length) return;

  let session = null;
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  links.forEach(link => {
    if (session?.user) {
      link.href = "/dashboard";
      link.classList.add("is-logged-in");
      link.innerHTML = `${avatarHtml(session.user)} <span>${isEnglish() ? "My space" : "Mon espace"}</span>`;
      link.setAttribute("aria-label", isEnglish() ? "Open my dashboard" : "Ouvrir mon espace");
    } else {
      link.href = "/login";
      link.classList.remove("is-logged-in");
      link.textContent = isEnglish() ? "Sign in" : "Connexion";
      link.setAttribute("aria-label", isEnglish() ? "Sign in with Google" : "Se connecter avec Google");
    }
  });

  if (!authListenerAttached) {
    authListenerAttached = true;
    try {
      const { supabase } = await getAuthContext();
      supabase?.auth.onAuthStateChange(() => renderAuthNav());
    } catch {
      authListenerAttached = false;
    }
  }
}

if (typeof window !== "undefined") {
  window.PublicMapAuth = {
    getAuthContext,
    getSession,
    signInWithGoogle,
    signOutToHome,
    renderAuthNav
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => renderAuthNav());
  } else {
    renderAuthNav();
  }
}
