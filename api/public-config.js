module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  function normalizeSupabaseUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return "";
      return url.origin;
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

  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const validAnonKey = isLikelyPublicApiKey(supabaseAnonKey);

  const missing = [];
  if (!normalizedSupabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!validAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  res.statusCode = 200;
  res.end(JSON.stringify({
    configured: missing.length === 0,
    missing,
    supabaseUrl: missing.length ? null : normalizedSupabaseUrl,
    supabaseAnonKey: missing.length ? null : supabaseAnonKey,
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL || null
  }));
};
