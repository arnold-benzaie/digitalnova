/** PUBLIC-MAP AI Assistant widget — every visible/aria string for the
 * chat widget lives here (§18 of the approved plan: "ne disperse pas les
 * textes FR/EN directement dans les composants"). Suggestion labels are
 * keyed by the same stable ids lib/ai/mock-provider.ts returns, so a
 * future real provider can keep returning ids without ever becoming a
 * second source of UI copy. */
export const chat = {
  fr: {
    trigger: {
      ariaLabel: "Ouvrir l'assistant PUBLIC-MAP",
      closeAriaLabel: "Fermer l'assistant PUBLIC-MAP",
    },
    welcomeBubble: {
      text: "👋 Bonjour ! Bienvenue chez PUBLIC-MAP.\nComment pouvons-nous vous aider aujourd'hui ?",
      closeAriaLabel: "Fermer le message d'accueil",
    },
    panel: {
      assistantName: "PUBLIC-MAP Assistant",
      onlineStatus: "En ligne",
      offlineStatus: "Nous vous répondrons dès que possible.",
      closeAriaLabel: "Fermer",
      minimizeAriaLabel: "Réduire",
      greetingAnonymous: "👋 Bonjour ! Bienvenue chez PUBLIC-MAP.\nComment pouvons-nous vous aider aujourd'hui ?",
      greetingNamed: (firstName: string) => `Bonjour ${firstName} 👋\nComment puis-je vous aider aujourd'hui ?`,
      greetingFallback: "Bonjour 👋\nComment puis-je vous aider aujourd'hui ?",
    },
    typingIndicator: "L'assistant écrit…",
    input: {
      placeholder: "Écrivez votre message…",
      sendAriaLabel: "Envoyer",
      sendButton: "Envoyer",
    },
    errors: {
      generic: "Une erreur est survenue. Veuillez réessayer.",
      rateLimited: "Trop de messages envoyés. Merci de patienter un instant avant de réessayer.",
      retry: "Réessayer",
    },
    suggestions: {
      title: "Suggestions",
      items: {
        google_ads: "Comment connecter mon compte Google Ads ?",
        how_it_works: "Comment fonctionne PUBLIC-MAP ?",
        performance: "Comment voir mes performances ?",
        account_help: "J'ai besoin d'aide avec mon compte",
        human: "Je souhaite parler à quelqu'un",
        gbp: "Améliorer mon Google Business Profile",
        seo: "Améliorer mon référencement SEO",
        website: "Créer ou améliorer mon site web",
        automation: "Automatiser mon entreprise",
        quote: "Obtenir un devis",
      } as Record<string, string>,
    },
    leadForm: {
      title: "Laissez-nous vos coordonnées",
      fullName: "Nom complet",
      email: "E-mail",
      phone: "Téléphone / WhatsApp",
      company: "Entreprise",
      country: "Pays",
      message: "Message / besoin",
      consentLabel: "J'accepte que PUBLIC-MAP me contacte concernant ma demande.",
      submit: "Envoyer",
      cancel: "Annuler",
      requiredError: "Merci de compléter les champs obligatoires.",
      consentRequiredError: "Merci d'accepter d'être contacté(e) pour continuer.",
      confirmation: "Merci. Votre demande a bien été transmise à PUBLIC-MAP. Un conseiller vous répondra dès que possible.",
    },
    escalation: {
      confirmation: "Votre demande a bien été transmise. Un membre de l'équipe PUBLIC-MAP vous répondra dès que possible.",
    },
  },
  en: {
    trigger: {
      ariaLabel: "Open PUBLIC-MAP assistant",
      closeAriaLabel: "Close PUBLIC-MAP assistant",
    },
    welcomeBubble: {
      text: "👋 Hi! Welcome to PUBLIC-MAP.\nHow can we help you today?",
      closeAriaLabel: "Close welcome message",
    },
    panel: {
      assistantName: "PUBLIC-MAP Assistant",
      onlineStatus: "Online",
      offlineStatus: "We'll get back to you as soon as possible.",
      closeAriaLabel: "Close",
      minimizeAriaLabel: "Minimize",
      greetingAnonymous: "👋 Hi! Welcome to PUBLIC-MAP.\nHow can we help you today?",
      greetingNamed: (firstName: string) => `Hi ${firstName} 👋\nHow can I help you today?`,
      greetingFallback: "Hi 👋\nHow can I help you today?",
    },
    typingIndicator: "Assistant is typing…",
    input: {
      placeholder: "Write your message…",
      sendAriaLabel: "Send",
      sendButton: "Send",
    },
    errors: {
      generic: "Something went wrong. Please try again.",
      rateLimited: "Too many messages sent. Please wait a moment before trying again.",
      retry: "Retry",
    },
    suggestions: {
      title: "Suggestions",
      items: {
        google_ads: "How do I connect my Google Ads account?",
        how_it_works: "How does PUBLIC-MAP work?",
        performance: "How can I see my performance?",
        account_help: "I need help with my account",
        human: "I'd like to talk to someone",
        gbp: "Improve my Google Business Profile",
        seo: "Improve my SEO",
        website: "Create or improve my website",
        automation: "Automate my business",
        quote: "Get a quote",
      } as Record<string, string>,
    },
    leadForm: {
      title: "Leave us your contact details",
      fullName: "Full name",
      email: "Email",
      phone: "Phone / WhatsApp",
      company: "Company",
      country: "Country",
      message: "Message / need",
      consentLabel: "I agree that PUBLIC-MAP may contact me regarding my request.",
      submit: "Send",
      cancel: "Cancel",
      requiredError: "Please fill in the required fields.",
      consentRequiredError: "Please agree to be contacted to continue.",
      confirmation: "Thank you. Your request has been sent to PUBLIC-MAP. An advisor will get back to you as soon as possible.",
    },
    escalation: {
      confirmation: "Your request has been forwarded. A PUBLIC-MAP team member will reply as soon as possible.",
    },
  },
};
