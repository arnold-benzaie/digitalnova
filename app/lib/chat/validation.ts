import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/message-sanitization";

/**
 * Zod is used ONLY for this new chat feature (§2 of the approved plan —
 * a deliberately scoped addition, never a project-wide validation
 * refactor). Every payload app/api/chat/route.ts accepts is defined
 * here, nowhere else.
 */

const localeSchema = z.enum(["fr", "en"]);

const uuidLikeSchema = z.string().uuid();

// visitorId's real shape is validated by lib/chat/visitor.ts's own
// isValidVisitorId() (exact 32-hex-char match) — this schema only
// enforces "a string, not absurdly long" so a malformed value fails
// Zod's own type check first with a clean 400, before ever reaching that
// stricter check.
const visitorIdSchema = z.string().min(1).max(64).optional();

// Phase 1B: which embed sent this request — "app" (Next.js dashboard
// widget, Phase 1A) or "site" (public-map.com marketing embed). Not a
// trust/authorization signal (ChatContext's kind is still resolved
// server-side from the session, exactly as before) — this only selects
// which canned suggestion chips/copy the mock provider returns, since an
// anonymous marketing-site prospect and a signed-in dashboard user need
// different ones. Defaults to "app" when absent so every existing
// Phase 1A request/test is byte-identical.
const surfaceSchema = z.enum(["app", "site"]).optional();

export const sendMessageSchema = z.object({
  type: z.literal("message"),
  conversationId: uuidLikeSchema.optional(),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  locale: localeSchema,
  visitorId: visitorIdSchema,
  suggestionId: z.string().max(64).optional(),
  surface: surfaceSchema,
});

export const leadSubmitSchema = z.object({
  type: z.literal("lead_submit"),
  conversationId: uuidLikeSchema,
  locale: localeSchema,
  visitorId: visitorIdSchema,
  fullName: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(150).optional(),
  country: z.string().trim().max(100).optional(),
  message: z.string().trim().min(1).max(2000),
  consent: z.literal(true),
});

export const escalateSchema = z.object({
  type: z.literal("escalate"),
  conversationId: uuidLikeSchema,
  locale: localeSchema,
  visitorId: visitorIdSchema,
});

export const chatRequestSchema = z.discriminatedUnion("type", [sendMessageSchema, leadSubmitSchema, escalateSchema]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;
