import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPathMatcher } from "@clerk/shared/pathMatcher";
import { PublicQuoteDocument } from "@/app/quote-verification/[token]/quote-document.tsx";
import { quoteVerification } from "@/lib/i18n/dictionaries/quote-verification.ts";
import { QUOTE_ACCESS_FAILURE_REASONS, resolvePublicQuote, toPublicQuoteViewModel } from "@/lib/quote-verification.ts";

const quoteSnapshot = {
  id: "internal-quote-id",
  clientId: "internal-client-id",
  quoteNumber: "DEV-2026-0042",
  title: "Accompagnement visibilité locale",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  validUntil: new Date("2026-09-01T00:00:00.000Z"),
  status: "sent",
  taxLabel: "TVA 20%",
  taxRateBasisPoints: 2000,
  subtotalCents: 25000,
  taxCents: 5000,
  totalCents: 30000,
  currency: "EUR",
  notes: "Paiement sous 30 jours.",
  dealId: "forbidden-deal-id",
  sentAt: new Date("2026-08-02T00:00:00.000Z"),
  respondedAt: null,
};

const quoteDetails = {
  client: {
    name: "Société Exemple",
    contactName: "Camille Martin",
    email: "camille@example.test",
    address: "10 rue privée",
    notes: "note CRM confidentielle",
    source: "salon privé",
    ownerName: "Responsable interne",
    organizationId: "internal-organization-id",
  },
  items: [
    {
      description: "Audit Google Maps — prix convenu",
      quantity: 2,
      unitPriceCents: 12500,
      serviceId: "catalogue-service-id",
      currentCataloguePriceCents: 999999,
    },
  ],
};

function publicQuote(overrides = {}) {
  return toPublicQuoteViewModel({ ...quoteSnapshot, ...overrides }, quoteDetails);
}

test("A-C — a valid token resolves the correct quote and preserves every stored amount, description and currency", async () => {
  let receivedToken;
  let receivedIdentifiers;
  const result = await resolvePublicQuote("valid-token-for-quote-42", {
    resolveToken: async (token) => {
      receivedToken = token;
      return { ok: true, quote: quoteSnapshot };
    },
    loadDetails: async (identifiers) => {
      receivedIdentifiers = identifiers;
      return quoteDetails;
    },
  });

  assert.equal(receivedToken, "valid-token-for-quote-42");
  assert.deepEqual(receivedIdentifiers, { quoteId: quoteSnapshot.id, clientId: quoteSnapshot.clientId });
  assert.equal(result.ok, true);
  assert.equal(result.quote.quoteNumber, "DEV-2026-0042");
  assert.deepEqual(result.quote.items, [
    {
      description: "Audit Google Maps — prix convenu",
      quantity: 2,
      unitPriceCents: 12500,
      lineTotalCents: 25000,
    },
  ]);
  assert.deepEqual(
    {
      subtotalCents: result.quote.subtotalCents,
      taxCents: result.quote.taxCents,
      totalCents: result.quote.totalCents,
      currency: result.quote.currency,
    },
    { subtotalCents: 25000, taxCents: 5000, totalCents: 30000, currency: "EUR" },
  );
});

test("D-G — nullable validity and notes remain explicit snapshot values", () => {
  const complete = publicQuote();
  assert.equal(complete.validUntil?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(complete.notes, "Paiement sous 30 jours.");

  const nullable = publicQuote({ validUntil: null, notes: null });
  assert.equal(nullable.validUntil, null);
  assert.equal(nullable.notes, null);

  const htmlWithValues = renderToStaticMarkup(React.createElement(PublicQuoteDocument, { quote: complete, locale: "fr" }));
  assert.match(htmlWithValues, /Valable jusqu&#x27;au/);
  assert.match(htmlWithValues, /Paiement sous 30 jours/);

  const htmlWithoutValues = renderToStaticMarkup(React.createElement(PublicQuoteDocument, { quote: nullable, locale: "fr" }));
  assert.match(htmlWithoutValues, /Non précisée/);
  assert.doesNotMatch(htmlWithoutValues, /id="quote-notes"/);
});

test("H-J — the public ViewModel excludes quote, client, CRM and Catalogue identifiers and private fields", () => {
  const result = publicQuote();

  assert.deepEqual(Object.keys(result).sort(), [
    "clientName",
    "contactName",
    "createdAt",
    "currency",
    "items",
    "notes",
    "quoteNumber",
    "status",
    "subtotalCents",
    "taxCents",
    "taxLabel",
    "taxRateBasisPoints",
    "title",
    "totalCents",
    "validUntil",
  ]);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["description", "lineTotalCents", "quantity", "unitPriceCents"]);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "internal-quote-id",
    "internal-client-id",
    "catalogue-service-id",
    "internal-organization-id",
    "camille@example.test",
    "10 rue privée",
    "note CRM confidentielle",
    "salon privé",
    "Responsable interne",
    "forbidden-deal-id",
    "currentCataloguePriceCents",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("K — production data access authorizes through resolveQuoteByToken and never reads Catalogue data", () => {
  const source = readFileSync(new URL("./quote-verification-data.ts", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../app/quote-verification/[token]/page.tsx", import.meta.url), "utf8");
  const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.match(source, /resolveToken:\s*resolveQuoteByToken/);
  assert.match(source, /\.from\(crmClients\)/);
  assert.match(source, /\.from\(crmQuoteItems\)/);
  assert.doesNotMatch(source, /crmQuoteAccessLinks|serviceMarketOffers|service_market_offers|\.from\(services\)/);
  assert.match(proxySource, /"\/quote-verification\/:token"/);
  assert.doesNotMatch(pageSource, /@clerk|requireSession|requireStaffRole|\/admin/);

  const viewModel = publicQuote();
  assert.equal(viewModel.items[0].unitPriceCents, 12500);
  assert.equal(viewModel.items[0].lineTotalCents, 25000);
  assert.notEqual(viewModel.items[0].unitPriceCents, quoteDetails.items[0].currentCataloguePriceCents);
});

test("public quote matcher exposes exactly one token segment and preserves every existing public route", () => {
  const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const matcherBlock = proxySource.match(/createRouteMatcher\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(matcherBlock, "the public route matcher must remain present");

  const publicPatterns = [...matcherBlock.matchAll(/^\s*"([^"]+)",/gm)].map((match) => match[1]);
  assert.deepEqual(publicPatterns, [
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/api/webhooks(.*)",
    "/api/cron(.*)",
    "/api/v1(.*)",
    "/developers(.*)",
    "/audit-report(.*)",
    "/api/invoices(.*)",
    "/invoice-verification(.*)",
    "/quote-verification/:token",
    "/audit-premium-showcase",
    "/audit-visual-preview",
    "/api/audit-report(.*)",
    "/api/gbp-audit/e2e-db-target",
    "/api/chat",
    "/invitation-link",
    "/accept-invitation",
  ]);

  const isPublicRoute = createPathMatcher(publicPatterns);
  assert.equal(isPublicRoute("/quote-verification/test-token"), true);
  for (const protectedPath of [
    "/quote-verification",
    "/quote-verification-extra",
    "/quote-verification/test-token/extra",
    "/admin",
    "/admin/crm",
    "/admin/crm/quotes",
  ]) {
    assert.equal(isPublicRoute(protectedPath), false, `${protectedPath} must remain protected`);
  }
});

test("L-P — every token failure remains generic and has the correct French and English message", async () => {
  const expectedMessages = {
    not_found: ["Ce lien n'est pas valide.", "This link is not valid."],
    expired: ["Ce lien a expiré.", "This link has expired."],
    revoked: ["Ce lien a été désactivé.", "This link has been disabled."],
    locked: [
      "Trop de tentatives ont été effectuées sur ce lien. Contactez PUBLIC-MAP pour consulter ce devis autrement.",
      "Too many attempts have been made on this link. Contact PUBLIC-MAP to view this quote another way.",
    ],
    rate_limited: [
      "Trop de tentatives depuis cette connexion. Merci de réessayer dans quelques minutes.",
      "Too many attempts from this connection. Please try again in a few minutes.",
    ],
  };

  for (const reason of QUOTE_ACCESS_FAILURE_REASONS) {
    let detailsRead = false;
    const result = await resolvePublicQuote("invalid-token", {
      resolveToken: async () => ({ ok: false, reason }),
      loadDetails: async () => {
        detailsRead = true;
        return quoteDetails;
      },
    });
    assert.deepEqual(result, { ok: false, reason });
    assert.equal(detailsRead, false);
    assert.equal(quoteVerification.fr.linkErrors[reason], expectedMessages[reason][0]);
    assert.equal(quoteVerification.en.linkErrors[reason], expectedMessages[reason][1]);
  }
});

test("Q-R — the public document exposes the complete required vocabulary in French and English", () => {
  const expectedLabels = {
    fr: ["Devis", "Date d’émission", "Valable jusqu'au", "Description", "Quantité", "Prix unitaire", "Sous-total", "Taxe", "Total", "Statut", "Notes"],
    en: ["Quote", "Issue date", "Valid until", "Description", "Quantity", "Unit price", "Subtotal", "Tax", "Total", "Status", "Notes"],
  };

  for (const locale of ["fr", "en"]) {
    const dictionaryText = Object.values(quoteVerification[locale]).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)));
    for (const label of expectedLabels[locale]) assert.ok(dictionaryText.includes(label), `${locale} is missing ${label}`);

    const html = renderToStaticMarkup(React.createElement(PublicQuoteDocument, { quote: publicQuote(), locale }));
    assert.match(html, /Audit Google Maps/);
    assert.match(html, locale === "fr" ? /Envoyé/ : /Sent/);
  }
});
