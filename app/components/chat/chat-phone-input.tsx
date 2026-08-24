"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PhoneInputWithCountrySelect, { getCountryCallingCode, type Country } from "react-phone-number-input";
import * as flagIcons from "country-flag-icons/react/3x2";
import frLabels from "react-phone-number-input/locale/fr.json";
import enLabels from "react-phone-number-input/locale/en.json";
import type { Locale } from "@/lib/i18n/dictionaries";

type CountryOption = { value?: Country; label: string; divider?: boolean };

/**
 * §Phase 1F — the library's own default country <select> has no real
 * search (browser-native typeahead only, matching from the start of the
 * visible label — no dial-code or ISO-code search at all), so this
 * plugs in as `countrySelectComponent` to add one, while still letting
 * `PhoneInputWithCountrySelect` (react-phone-number-input) own every bit
 * of actual phone-number state/parsing/formatting — never reimplemented
 * here. `options` arrives already filtered to real countries and
 * already localized (via the `locales` prop below) — nothing to build
 * or maintain locally.
 */
function SearchableCountrySelect({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  searchPlaceholder,
}: {
  value?: Country;
  onChange: (country: Country | undefined) => void;
  options: CountryOption[];
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const countries = useMemo(() => options.filter((option): option is CountryOption & { value: Country } => Boolean(option.value) && !option.divider), [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    const qDigits = q.replace(/^\+/, "");
    return countries.filter((option) => {
      if (option.label.toLowerCase().includes(q)) return true;
      if (option.value.toLowerCase() === q) return true;
      if (qDigits && getCountryCallingCode(option.value).includes(qDigits)) return true;
      return false;
    });
  }, [countries, query]);

  // Same outside-click / Escape pattern already established for the
  // emoji picker (chat-emoji-picker.tsx) — kept consistent rather than
  // inventing a second popover-dismissal approach in the same widget.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const current = countries.find((option) => option.value === value);
  const CurrentFlag = value ? flagIcons[value] : undefined;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex h-7 shrink-0 items-center gap-1 rounded px-1 text-sm text-pm-noir hover:bg-pm-gris-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {CurrentFlag ? <CurrentFlag title={current?.label} className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" /> : <span aria-hidden="true">🌐</span>}
        <span className="text-xs text-pm-gris">{value ? `+${getCountryCallingCode(value)}` : ""}</span>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="absolute top-full left-0 z-10 mt-1 w-64 rounded-xl border border-pm-gris-2 bg-pm-blanc p-2 shadow-pm-md">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={ariaLabel}
            className="border-input mb-1.5 h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <li className="px-2 py-1.5 text-xs text-pm-gris">—</li>}
            {filtered.map((option) => {
              const Flag = flagIcons[option.value];
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-pm-gris-2/60 ${option.value === value ? "bg-pm-gris-2/40" : ""}`}
                  >
                    {Flag && <Flag title={option.label} className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="shrink-0 text-xs text-pm-gris">+{getCountryCallingCode(option.value)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ChatPhoneInput({
  value,
  onChange,
  defaultCountry,
  locale,
  ariaLabel,
  countrySelectAriaLabel,
  countrySearchPlaceholder,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultCountry?: Country;
  locale: Locale;
  ariaLabel: string;
  countrySelectAriaLabel: string;
  countrySearchPlaceholder: string;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <PhoneInputWithCountrySelect
      international
      // NOT `countryCallingCodeEditable={false}`: that mode forces every
      // input to start with the CURRENTLY selected country's own prefix
      // and discards anything that doesn't — which broke pasting/typing a
      // full number for a DIFFERENT country entirely (the input just
      // collapsed back to the old prefix instead of switching). The
      // library's default (`true`) is what actually implements "detect
      // the country from a full +-prefixed number" — and `international`
      // mode already prevents a double-typed dial code on its own, since
      // a value starting with "+" is parsed as the complete E.164 attempt,
      // never appended to an existing prefix (§6: "jamais deux fois
      // l'indicatif").
      value={value || undefined}
      onChange={(next) => onChange(next ?? "")}
      defaultCountry={defaultCountry}
      labels={locale === "fr" ? frLabels : enLabels}
      disabled={disabled}
      countrySelectComponent={(props: React.ComponentProps<typeof SearchableCountrySelect>) => (
        <SearchableCountrySelect {...props} ariaLabel={countrySelectAriaLabel} searchPlaceholder={countrySearchPlaceholder} />
      )}
      numberInputProps={{
        "aria-label": ariaLabel,
        placeholder,
        inputMode: "tel",
        className:
          "border-input placeholder:text-muted-foreground h-9 min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 text-sm shadow-none outline-none disabled:cursor-not-allowed disabled:opacity-50",
      }}
      className="border-input flex h-9 w-full items-center gap-1 rounded-md border bg-transparent px-2 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
    />
  );
}
