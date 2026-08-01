import type { AIProvider, AuditInput, AuditIssue, AuditResult, OnboardingSummary } from "./types";

/**
 * Stands in for a real Claude-backed audit (Vercel AI SDK, per the
 * architecture plan). ANTHROPIC_API_KEY is still a placeholder in
 * .env.local — this generates a deterministic, rule-based "audit" from
 * the input metrics instead of calling an LLM.
 */
export class MockAIProvider implements AIProvider {
  async generateAudit(input: AuditInput): Promise<AuditResult> {
    // Three independently capped components (40 + 30 + 30 = 100) instead of
    // an unbounded weighted sum — keeps the score from saturating at 100
    // for any reasonably active location.
    const ratingComponent = (input.averageRating / 5) * 40;
    const callsComponent = Math.min(30, input.metrics.calls * 2.5);
    const directionsComponent = Math.min(30, input.metrics.directionRequests * 1.2);
    const score = Math.round(ratingComponent + callsComponent + directionsComponent);

    const issues: AuditIssue[] = [];

    if (input.averageRating < 4.5) {
      issues.push({
        title: "Note moyenne perfectible",
        description: `La note moyenne actuelle est de ${input.averageRating.toFixed(1)}/5 sur ${input.reviewCount} avis.`,
        priority: "medium",
        recommendation: "Encourager les clients satisfaits à laisser un avis et répondre aux avis existants.",
      });
    }

    if (input.metrics.calls < 10) {
      issues.push({
        title: "Peu d'appels générés",
        description: "Le volume d'appels depuis la fiche est en dessous de la moyenne du secteur.",
        priority: "high",
        recommendation: "Vérifier que le numéro de téléphone est à jour et mettre en avant un call-to-action.",
      });
    }

    issues.push({
      title: "Photos et informations à jour",
      description: "Une fiche régulièrement mise à jour est mieux valorisée par Google.",
      priority: "low",
      recommendation: "Ajouter de nouvelles photos et vérifier les horaires au moins une fois par mois.",
    });

    return {
      score: Math.max(0, Math.min(100, score)),
      summary: `Audit généré automatiquement (données simulées) pour ${input.locationName}.`,
      issues,
    };
  }

  async summarizeOnboarding(answers: Record<string, string>): Promise<OnboardingSummary> {
    const businessName = answers.businessName?.trim() || "cette entreprise";
    const goal = answers.mainGoal?.trim();
    const frustration = answers.frustration?.trim();

    const parts = [`Synthèse des besoins pour ${businessName} (résumé généré automatiquement — données simulées).`];

    if (goal) {
      parts.push(`Objectif principal exprimé : ${goal}.`);
    }
    if (answers.hasGbp) {
      parts.push(
        answers.hasGbp.toLowerCase().startsWith("oui")
          ? "Dispose déjà d'une fiche Google Business Profile — l'accompagnement portera surtout sur l'optimisation."
          : "Ne dispose pas encore de fiche Google Business Profile — la création et la vérification seront la première étape.",
      );
    }
    if (frustration) {
      parts.push(`Point de friction principal signalé : ${frustration}.`);
    }

    return {
      summary: parts.join(" "),
      nextStep: "Connecter Google Business Profile puis lancer un premier audit IA.",
    };
  }
}
