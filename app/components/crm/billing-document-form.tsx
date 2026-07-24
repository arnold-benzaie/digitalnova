"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeTotals, CURRENCY_OPTIONS, formatMoney } from "@/lib/crm-billing";

type Item = { description: string; quantity: string; unitPrice: string };
type ClientOption = { id: string; name: string };
type DealOption = { id: string; title: string };

type Initial = {
  clientId: string;
  dealId?: string | null;
  title: string;
  currency: string;
  taxLabel?: string | null;
  taxRatePercent: number;
  notes?: string | null;
  dateValue?: string;
  items: { description: string; quantity: number; unitPriceCents: number }[];
};

export function BillingDocumentForm({
  action,
  submitLabel,
  clientOptions,
  fixedClientId,
  dealOptions,
  dateField,
  initial,
  onDone,
}: {
  action: (formData: FormData) => Promise<unknown>;
  submitLabel: string;
  clientOptions?: ClientOption[];
  fixedClientId?: string;
  dealOptions?: DealOption[];
  dateField: { name: "validUntil" | "dueAt"; label: string };
  initial?: Initial;
  onDone?: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [taxRatePercent, setTaxRatePercent] = useState(String(initial?.taxRatePercent ?? 0));
  const [items, setItems] = useState<Item[]>(
    initial?.items.length
      ? initial.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: (i.unitPriceCents / 100).toFixed(2) }))
      : [{ description: "", quantity: "1", unitPrice: "" }],
  );

  const parsedItems = items
    .filter((i) => i.description.trim())
    .map((i) => ({
      description: i.description.trim(),
      quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
      unitPriceCents: Math.round((Number(i.unitPrice) || 0) * 100),
    }));
  const taxRateBasisPoints = Math.round((Number(taxRatePercent) || 0) * 100);
  const totals = computeTotals(parsedItems, taxRateBasisPoints);

  function updateItem(index: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addItem() {
    setItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "" }]);
  }
  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      action={(formData) => {
        formData.set("items", JSON.stringify(parsedItems));
        startTransition(async () => {
          setError(null);
          try {
            await action(formData);
            formRef.current?.reset();
            setItems([{ description: "", quantity: "1", unitPrice: "" }]);
            onDone?.();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fixedClientId && clientOptions && (
          <select
            name="clientId"
            required
            defaultValue={initial?.clientId ?? ""}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="" disabled>
              Client *
            </option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {fixedClientId && <input type="hidden" name="clientId" value={fixedClientId} />}

        {dealOptions && dealOptions.length > 0 && (
          <select name="dealId" defaultValue={initial?.dealId ?? ""} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
            <option value="">Opportunité liée (optionnel)</option>
            {dealOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        )}

        <input
          name="title"
          required
          defaultValue={initial?.title ?? ""}
          placeholder="Titre *"
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir sm:col-span-2"
        />

        <select
          name="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <label className="flex flex-col gap-1 text-xs text-pm-gris">
          {dateField.label}
          <input name={dateField.name} type="date" defaultValue={initial?.dateValue ?? ""} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
        </label>

        <input
          name="taxLabel"
          defaultValue={initial?.taxLabel ?? ""}
          placeholder='Libellé taxe (ex. "TVA", "TPS/TVQ")'
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        />
        <label className="flex items-center gap-2 text-sm text-pm-noir">
          Taux de taxe (%)
          <input
            name="taxRateBasisPoints"
            type="number"
            min={0}
            step="0.01"
            value={taxRatePercent}
            onChange={(e) => setTaxRatePercent(e.target.value)}
            className="w-24 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">Lignes</p>
        {items.map((item, index) => (
          <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={item.description}
              onChange={(e) => updateItem(index, { description: e.target.value })}
              placeholder="Description *"
              className="flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
            />
            <input
              value={item.quantity}
              onChange={(e) => updateItem(index, { quantity: e.target.value })}
              type="number"
              min={1}
              placeholder="Qté"
              className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir sm:w-20"
            />
            <input
              value={item.unitPrice}
              onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
              type="number"
              min={0}
              step="0.01"
              placeholder="Prix unitaire"
              className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir sm:w-32"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              disabled={items.length <= 1}
              className="shrink-0 text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-30"
            >
              Retirer
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem} className="self-start text-xs text-pm-noir underline">
          + Ajouter une ligne
        </button>
      </div>

      <textarea
        name="notes"
        rows={2}
        defaultValue={initial?.notes ?? ""}
        placeholder="Notes (optionnel)"
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />

      <div className="flex flex-col items-end gap-1 rounded-lg bg-pm-gris-2/20 p-3 text-sm">
        <p className="text-pm-gris">Sous-total : {formatMoney(totals.subtotalCents, currency)}</p>
        <p className="text-pm-gris">Taxe : {formatMoney(totals.taxCents, currency)}</p>
        <p className="font-semibold text-pm-noir">Total : {formatMoney(totals.totalCents, currency)}</p>
      </div>

      {error && <p className="text-sm text-pm-rouge">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Enregistrement..." : submitLabel}
      </button>
    </form>
  );
}
