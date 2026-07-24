import { renderToBuffer } from "@react-pdf/renderer";
import { resolveReportByToken } from "@/lib/actions/gbp-audit-portal";
import { buildAuditReportData } from "@/lib/gbp-audit/report-data";
import { GbpAuditReportPdf } from "@/lib/pdf/gbp-audit-report";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/gbp-audit/rate-limit";

/** PUBLIC — token-gated, no Clerk session. Always the simplified client version. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Separate, tighter limit than resolveReportByToken's own check below:
  // rendering a PDF is CPU-heavy, so it warrants its own budget even for
  // someone who's within the plain lookup's rate limit.
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit("portal_pdf", ip, 10, 300);
  if (!rate.allowed) {
    return new Response("Trop de téléchargements. Réessayez dans quelques minutes.", { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const resolved = await resolveReportByToken(token);

  if (!resolved.ok) {
    return new Response("Ce lien n'est plus valide.", { status: 404 });
  }

  const data = await buildAuditReportData({
    auditId: resolved.audit.id,
    businessName: resolved.business.legalName,
    agentName: null,
    executiveSummary: null,
    clientSummary: resolved.report.clientSummary,
    score: resolved.audit,
    businessProfile: {
      rating: resolved.business.currentRating,
      reviewCount: resolved.business.currentReviewCount,
      photoCount: resolved.business.currentPhotoCount,
      postsRecent: resolved.business.postsRecent,
    },
    clientFacing: true,
  });

  const buffer = await renderToBuffer(GbpAuditReportPdf({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="audit-${resolved.business.legalName.replace(/[^a-z0-9]+/gi, "-")}.pdf"`,
    },
  });
}
