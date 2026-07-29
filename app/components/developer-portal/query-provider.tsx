"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DeveloperPortalToaster } from "@/components/developer-portal/toaster";

/**
 * Client boundary for the whole /developers tree (Stage 0 of the
 * developer-platform plan) — never mounted in the root app/layout.tsx,
 * which serves dashboard/admin/CRM and has no use for a query client.
 * queryFn implementations call server actions directly (same pattern
 * api-keys-manager.tsx already uses), reserved for views that need
 * polling/auto-refresh rather than every page load.
 *
 * TooltipProvider lives here too (shadcn's own setup note asks for it
 * near the root) rather than as a second, separate client boundary.
 */
export function DeveloperPortalProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        {children}
        <DeveloperPortalToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
