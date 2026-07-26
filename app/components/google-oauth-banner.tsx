import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function GoogleOAuthBanner({ flag, reason, locale = "fr" }: { flag?: string; reason?: string; locale?: Locale }) {
  if (!flag) return null;
  const t = dictionaries[locale].dashboard.googleIntegration.oauthBanner;
  const reasonLabel = reason ? t.reasons[reason] : undefined;

  if (flag === "connected") {
    return (
      <div className="mb-4 rounded-xl border border-pm-g-green/30 bg-pm-g-green/10 px-4 py-3 text-sm text-pm-noir">
        {t.connected}
      </div>
    );
  }
  if (flag === "partial") {
    return (
      <div className="mb-4 rounded-xl border border-pm-or/30 bg-pm-or/10 px-4 py-3 text-sm text-pm-noir">
        {reasonLabel || t.partial}
      </div>
    );
  }
  if (flag === "denied") {
    return (
      <div className="mb-4 rounded-xl border border-pm-gris-2 bg-pm-gris-2/30 px-4 py-3 text-sm text-pm-noir">
        {t.denied}
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-pm-rouge/30 bg-pm-rouge/10 px-4 py-3 text-sm text-pm-noir">
      {reasonLabel || t.failed}
    </div>
  );
}
