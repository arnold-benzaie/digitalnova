"use client";

import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { setOrganizationMarketAction } from "@/lib/actions/market";
import type { Market } from "@/lib/market/context";

export function OrganizationMarketSelect({
  organizationId,
  market,
  notSetLabel,
  canadaLabel,
  europeLabel,
}: {
  organizationId: string;
  market: Market | null;
  notSetLabel: string;
  canadaLabel: string;
  europeLabel: string;
}) {
  const options = [
    ...(market ? [] : [{ value: "", label: notSetLabel }]),
    { value: "CANADA", label: canadaLabel },
    { value: "EUROPE", label: europeLabel },
  ];

  return (
    <div data-testid="organization-market-select">
      <InlineStatusSelect
        value={market ?? ""}
        options={options}
        action={(value) => setOrganizationMarketAction(organizationId, value)}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
      />
    </div>
  );
}
