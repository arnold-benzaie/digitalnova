"use server";

import { GENERIC_ERROR_CATEGORIES, type GenericErrorCategory } from "@/lib/errors/categorize-generic-error";
import { recordUiFailureAndMaybeAlert } from "@/lib/ui-errors";

/**
 * The only bridge between a Client Component error boundary
 * (app/error.tsx, app/global-error.tsx — neither can import
 * server-only modules directly) and the server-side `ui` alerting
 * path. The caller categorizes its own error client-side first (via
 * categorizeGenericError, which is a plain isomorphic module — no
 * "server-only"/@/db import — so it runs fine in the browser) and
 * sends only the resulting closed-set category label here, never the
 * raw error/message/stack. That means a potentially sensitive error
 * string never crosses the network at all, not even transiently.
 *
 * Re-validates the incoming category against the same closed set
 * before using it, since a Server Action is a public endpoint any
 * client script could call directly with an arbitrary string.
 *
 * Never throws back to the caller: this is called fire-and-forget from
 * a useEffect, and an observability failure here must never surface as
 * a second error on top of the one already being displayed.
 */
export async function reportUiError(category: string, pathname: string): Promise<void> {
  try {
    if (!GENERIC_ERROR_CATEGORIES.includes(category as GenericErrorCategory)) return;
    await recordUiFailureAndMaybeAlert(category, typeof pathname === "string" && pathname ? pathname : "unknown");
  } catch {
    // Never let an observability failure escalate — the UI error boundary
    // must keep rendering its fallback regardless of what happens here.
  }
}
