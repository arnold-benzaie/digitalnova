import { MockAIProvider } from "./mock-provider";
import type { AIProvider } from "./types";

/**
 * ANTHROPIC_API_KEY is still a placeholder in .env.local — always resolves
 * to the mock provider for now. Swap in a real Claude-backed AIProvider
 * (Vercel AI SDK) here once a real key is set.
 */
export function getAIProvider(): AIProvider {
  return new MockAIProvider();
}

export type { AIProvider, AuditInput, AuditIssue, AuditResult } from "./types";
