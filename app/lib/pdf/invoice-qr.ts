import QRCode from "qrcode";
import { APP_BASE_URL } from "@/lib/brand";

/** Builds the public verification URL for a given invoice access token —
 * the same token already used for the emailed PDF link (crm_invoice_access_links.token,
 * see lib/actions/crm-invoice-access.ts). One token, two surfaces (email
 * link + QR code), never a second credential. */
export function invoiceVerificationUrl(token: string): string {
  return `${APP_BASE_URL}/invoice-verification/${token}`;
}

/** PNG data URI of a QR code encoding the invoice's verification URL —
 * same "static asset → base64 data URI → <Image>" pattern already used
 * for the brand logo (lib/pdf/brand-logo.ts), so @react-pdf/renderer can
 * embed it without touching the filesystem at render time. Never encodes
 * anything beyond this one opaque-token URL — no client data, no secrets. */
export async function buildInvoiceQrDataUri(token: string): Promise<string> {
  const url = invoiceVerificationUrl(token);
  // errorCorrectionLevel "M" (15% recovery) balances print-scan robustness
  // against QR density for a URL this length; margin 1 keeps the quiet
  // zone print scanners expect without wasting PDF space.
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}
