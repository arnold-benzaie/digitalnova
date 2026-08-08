"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Re-fetches the server component tree every 5 minutes so the dashboard
 * stays current without a manual reload — router.refresh() re-runs the
 * page's server-side data fetch (cache.ts decides whether that's a real
 * GA4 call or a cache hit), no client-side polling library needed. */
export function AnalyticsAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
