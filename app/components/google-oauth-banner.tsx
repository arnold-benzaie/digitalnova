import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function GoogleOAuthBanner({ flag, reason, locale = "fr" }: { flag?: string; reason?: string; locale?: Locale }) {
  if (!flag) return null;
  const t = dictionaries[locale].dashboard.googleIntegration.oauthBanner;
  const reasonLabel = reason ? t.reasons[reason] : undefined;

  if (flag === "connected") {
    return (
      <div className="mb-4 rounded-2xl border border-pm-g-green/25 bg-pm-g-green/[0.06] px-4 py-3 text-sm text-pm-noir shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
        {t.connected}
      </div>
    );
  }
  if (flag === "partial") {
    return (
      <div className="mb-4 rounded-2xl border border-pm-or/25 bg-pm-or/[0.06] px-4 py-3 text-sm text-pm-noir shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
        {reasonLabel || t.partial}
      </div>
    );
  }
  if (flag === "denied") {
    return (
      <div className="mb-4 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/20 px-4 py-3 text-sm text-pm-noir shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
        {t.denied}
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-2xl border border-pm-rouge/25 bg-pm-rouge/[0.06] px-4 py-3 text-sm text-pm-noir shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
      {reasonLabel || t.failed}
    </div>
  );
}
