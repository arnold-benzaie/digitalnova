export type SignatureRequest = {
  providerRequestId: string;
  status: "sent" | "signed" | "declined";
};

export interface ESignProvider {
  sendForSignature(input: { title: string; content: string; signerName: string; signerEmail: string }): Promise<SignatureRequest>;
}
