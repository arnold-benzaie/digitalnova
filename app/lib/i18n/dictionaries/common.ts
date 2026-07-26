/**
 * Shared vocabulary reused across every domain — save/cancel/confirm/
 * delete/edit/search/filter/back/next/previous/loading/empty/error/
 * success/status words. Other domain dictionaries should reference
 * `dictionaries[locale].common.<key>` instead of redefining these, so
 * "Enregistrer"/"Save" etc. is translated exactly once.
 */
export const common = {
  fr: {
    save: "Enregistrer",
    saving: "Enregistrement…",
    cancel: "Annuler",
    confirm: "Confirmer",
    delete: "Supprimer",
    edit: "Modifier",
    search: "Rechercher",
    filter: "Filtrer",
    back: "Retour",
    next: "Suivant",
    previous: "Précédent",
    loading: "Chargement…",
    noResults: "Aucun résultat.",
    error: "Une erreur est survenue.",
    success: "Succès.",
    close: "Fermer",
    add: "Ajouter",
    send: "Envoyer",
    sending: "Envoi…",
    download: "Télécharger",
    export: "Exporter",
    status: {
      active: "Actif",
      pending: "En attente",
      refused: "Refusé",
      suspended: "Suspendu",
    },
    never: "Jamais",
  },
  en: {
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    edit: "Edit",
    search: "Search",
    filter: "Filter",
    back: "Back",
    next: "Next",
    previous: "Previous",
    loading: "Loading…",
    noResults: "No results.",
    error: "Something went wrong.",
    success: "Success.",
    close: "Close",
    add: "Add",
    send: "Send",
    sending: "Sending…",
    download: "Download",
    export: "Export",
    status: {
      active: "Active",
      pending: "Pending",
      refused: "Refused",
      suspended: "Suspended",
    },
    never: "Never",
  },
} as const;
