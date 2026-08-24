import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/core";
// Explicit metadata import + the "core" build (rather than the
// top-level `libphonenumber-js` package, which bundles its own copy of
// this same file behind an internal `require(".../metadata.min.json")`)
// — the top-level import triggers a tsx/Node ESM-CJS interop bug in this
// project's test runner (`tsx --test`) where that nested require resolves
// to `{ default: <metadata> }` instead of the raw metadata object,
// crashing every parse. Importing the metadata ourselves sidesteps it
// entirely. No `with { type: "json" }` assertion: this subpath's own
// "import" condition (package.json's `exports` map) already points to
// metadata.min.json.js, a plain `export default {...}` — not the raw
// .json file — asserting `type: "json"` here made webpack try to
// JSON-parse that .js file's source text and fail on its comments.
import metadata from "libphonenumber-js/metadata.min.json";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/message-sanitization";
import { REQUEST_TYPE_KEYS } from "@/lib/chat/request-type-catalog";

// §Phase 1F — both widgets send E.164 ("+<countrycode><number>", e.g.
// "+230xxxxxxxx") once libphonenumber-js has confirmed the number is
// valid client-side; an empty field is sent as "" (optional, never
// required — see chat-lead-form.tsx / chat-widget-embed.js). Re-validates
// with the SAME library server-side (defense in depth: never trust a
// client-side-only check) rather than a hand-rolled regex — a client
// could still submit past its own JS validation, and a naive regex
// would either be too loose (accepting garbage) or too strict
// (rejecting real numbers in less-common formats).
const phoneSchema = z
  .string()
  .trim()
  .max(50)
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || isValidPhoneNumber(value, metadata), { message: "invalid_phone" });

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
  // Optional (was required): the calendar-button entry point (§Phase 1D)
  // can open this same form before any message has been sent, so there
  // may be no conversation yet — handleLeadSubmit now resolves it via
  // getOrCreateConversation(), the exact same helper handleMessage
  // already uses, rather than requiring one to pre-exist.
  conversationId: uuidLikeSchema.optional(),
  locale: localeSchema,
  visitorId: visitorIdSchema,
  fullName: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(200),
  phone: phoneSchema,
  company: z.string().trim().max(150).optional(),
  country: z.string().trim().max(100).optional(),
  // §Phase 1D — booking/lead form's "Type de demande": a closed set,
  // never free text (see request-type-catalog.ts's own header comment
  // on why the client only ever sends a validated key).
  requestType: z.enum(REQUEST_TYPE_KEYS),
  // Both explicitly a DECLARED PREFERENCE, never a confirmed booking —
  // enforced by copy (dictionaries' preferredNote / confirmation text),
  // not by validation; kept loose here (a plain optional string, not a
  // strict date/time type) since no real scheduling system is connected
  // yet to compute against. `<input type="date">` on both surfaces still
  // yields a clean ISO "YYYY-MM-DD" in practice.
  preferredDate: z.string().trim().max(32).optional(),
  preferredTimeSlot: z.string().trim().max(100).optional(),
  message: z.string().trim().min(1).max(2000),
  consent: z.literal(true),
  // Same optional, defaults-to-"app" field as sendMessageSchema — only
  // used to label the internal lead-notification email (§7: "surface :
  // site ou app"), never a trust/authorization signal.
  surface: surfaceSchema,
});

export const escalateSchema = z.object({
  type: z.literal("escalate"),
  conversationId: uuidLikeSchema,
  locale: localeSchema,
  visitorId: visitorIdSchema,
});

export const chatRequestSchema = z.discriminatedUnion("type", [sendMessageSchema, leadSubmitSchema, escalateSchema]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;
