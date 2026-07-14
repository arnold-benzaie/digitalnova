import crypto from "node:crypto";

/**
 * FastSpring signs webhook payloads with HMAC-SHA256 (base64) of the raw
 * request body, using the webhook's configured "Secret Key," sent in the
 * `X-FS-Signature` header. This implements that documented pattern, but is
 * untested against a real FastSpring account (none exists yet) — double
 * check the header name and algorithm against FastSpring's current webhook
 * docs before relying on this in production.
 */
export function verifyFastspringSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
