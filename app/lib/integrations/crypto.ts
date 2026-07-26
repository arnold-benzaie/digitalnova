import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const API_KEY_HASH_VERSION = 1;

export type EncryptedIntegrationValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function encryptionKey(encodedKey = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY): Buffer {
  if (!encodedKey) {
    throw new Error("INTEGRATION_SECRET_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("INTEGRATION_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function apiKeyPepper(pepper = process.env.INTEGRATION_API_KEY_PEPPER): string {
  if (!pepper) {
    throw new Error("INTEGRATION_API_KEY_PEPPER is not configured.");
  }
  return pepper;
}

export function encryptIntegrationValue(
  plaintext: string,
  context: string,
  encodedKey?: string,
): EncryptedIntegrationValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptIntegrationValue(
  encrypted: EncryptedIntegrationValue,
  context: string,
  encodedKey?: string,
): string {
  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      encryptionKey(encodedKey),
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted integration value could not be decrypted.");
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function webhookUrlHash(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex");
}

export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}

export function generateIntegrationApiKey(environment: "live" | "test" = "live", pepper?: string) {
  const lookupId = randomBytes(9).toString("base64url");
  const keyPrefix = `pm_${environment}_${lookupId}`;
  const plaintextKey = `${keyPrefix}_${randomBytes(32).toString("base64url")}`;

  return {
    plaintextKey,
    lookupId,
    keyPrefix,
    keyHash: hashIntegrationApiKey(plaintextKey, pepper),
    hashVersion: API_KEY_HASH_VERSION,
  };
}

export function hashIntegrationApiKey(plaintextKey: string, pepper?: string): string {
  return createHmac("sha256", apiKeyPepper(pepper)).update(plaintextKey, "utf8").digest("hex");
}

export function verifyIntegrationApiKey(plaintextKey: string, expectedHash: string, pepper?: string): boolean {
  const actual = Buffer.from(hashIntegrationApiKey(plaintextKey, pepper), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
