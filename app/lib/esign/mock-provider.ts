import type { ESignProvider, SignatureRequest } from "./types";

/**
 * Stands in for a real e-signature provider (DocuSign or Dropbox Sign, per
 * the architecture plan — build-vs-buy: regulated territory, don't build
 * signature validity in-house). No credentials exist yet, so this just
 * mints a fake request id; the recipient's actual signing happens nowhere
 * — use the "simulate signature" action in the UI to move a contract to
 * "signed" for demo purposes.
 */
export class MockESignProvider implements ESignProvider {
  async sendForSignature(): Promise<SignatureRequest> {
    return {
      providerRequestId: `mock-esign-${Date.now()}`,
      status: "sent",
    };
  }
}
