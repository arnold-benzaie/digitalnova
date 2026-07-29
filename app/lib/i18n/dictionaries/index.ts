/**
 * i18n dictionary — split by domain (one file per functional area) and
 * merged here into the same flat shape every call site already uses:
 * `dictionaries[locale].<domain>.<key>`. This file replaces what used to
 * be a single lib/i18n/dictionaries.ts; the import path
 * `@/lib/i18n/dictionaries` is unchanged (it now resolves to this
 * directory's index.ts instead of a flat file), so no existing call site
 * needed to change.
 *
 * Adding a new domain: create lib/i18n/dictionaries/<name>.ts exporting
 * `{ fr: {...}, en: {...} }`, import it below, and add it under both
 * locale branches with a stable key. Keep genuinely shared vocabulary
 * (Save/Cancel/Confirm/...) in `common` instead of repeating it per domain.
 */
import { common } from "./common";
import { navigation } from "./navigation";
import { accessPending, accessDenied, accessRefused, accessSuspended } from "./access";
import { adminUsers } from "./admin-users";
import { dashboard } from "./dashboard";
import { settings } from "./settings";
import { notificationsPage } from "./notifications";
import { auditModule } from "./audit-module";
import { crm } from "./crm";
import { integrations } from "./integrations";
import { developers } from "./developers";
import { developerConsole } from "./developer-console";

export type { Locale } from "./types";
export { LOCALES } from "./types";

export const dictionaries = {
  fr: {
    common: common.fr,
    navigation: navigation.fr,
    accessPending: accessPending.fr,
    accessDenied: accessDenied.fr,
    accessRefused: accessRefused.fr,
    accessSuspended: accessSuspended.fr,
    adminUsers: adminUsers.fr,
    dashboard: dashboard.fr,
    settings: settings.fr,
    notificationsPage: notificationsPage.fr,
    auditModule: auditModule.fr,
    crm: crm.fr,
    integrations: integrations.fr,
    developers: developers.fr,
    developerConsole: developerConsole.fr,
  },
  en: {
    common: common.en,
    navigation: navigation.en,
    accessPending: accessPending.en,
    accessDenied: accessDenied.en,
    accessRefused: accessRefused.en,
    accessSuspended: accessSuspended.en,
    adminUsers: adminUsers.en,
    dashboard: dashboard.en,
    settings: settings.en,
    notificationsPage: notificationsPage.en,
    auditModule: auditModule.en,
    crm: crm.en,
    integrations: integrations.en,
    developers: developers.en,
    developerConsole: developerConsole.en,
  },
} as const;
