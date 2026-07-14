import { MockESignProvider } from "./mock-provider";
import type { ESignProvider } from "./types";

/**
 * No real e-signature provider credentials exist yet. Always resolves to
 * the mock provider for now; swap in a real DocuSign/Dropbox Sign-backed
 * ESignProvider here once an account is set up.
 */
export function getESignProvider(): ESignProvider {
  return new MockESignProvider();
}

export type { ESignProvider, SignatureRequest } from "./types";
