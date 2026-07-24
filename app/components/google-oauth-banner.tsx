const REASON_LABEL: Record<string, string> = {
  gbp_sync_failed:
    "Le compte Google a été connecté, mais la récupération des données Google Business Profile a échoué (l'accès à l'API n'est peut-être pas encore approuvé par Google).",
  token_exchange_failed: "L'échange du code d'autorisation avec Google a échoué.",
  invalid_state: "La demande de connexion a expiré ou est invalide — merci de réessayer.",
  invalid_request: "Requête de connexion Google invalide.",
};

export function GoogleOAuthBanner({ flag, reason }: { flag?: string; reason?: string }) {
  if (!flag) return null;

  if (flag === "connected") {
    return (
      <div className="mb-4 rounded-xl border border-pm-g-green/30 bg-pm-g-green/10 px-4 py-3 text-sm text-pm-noir">
        Compte Google connecté avec succès.
      </div>
    );
  }
  if (flag === "partial") {
    return (
      <div className="mb-4 rounded-xl border border-pm-or/30 bg-pm-or/10 px-4 py-3 text-sm text-pm-noir">
        {(reason && REASON_LABEL[reason]) || "Compte Google connecté, mais une partie de la synchronisation a échoué."}
      </div>
    );
  }
  if (flag === "denied") {
    return (
      <div className="mb-4 rounded-xl border border-pm-gris-2 bg-pm-gris-2/30 px-4 py-3 text-sm text-pm-noir">
        Connexion Google annulée.
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-pm-rouge/30 bg-pm-rouge/10 px-4 py-3 text-sm text-pm-noir">
      {(reason && REASON_LABEL[reason]) || "La connexion au compte Google a échoué."}
    </div>
  );
}
