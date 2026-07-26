import type { SVGProps } from "react";

/**
 * Small icon set for the /access-pending "premium" redesign, matching the
 * stroke conventions already used in components/gbp-audit/ui/nav-icons.tsx
 * (round caps/joins, currentColor stroke) so it doesn't introduce a second
 * visual language into the app — just scoped to icons this page needed
 * that didn't already exist there.
 */

/** Clock face + check badge: "your request is being reviewed, and will be approved." Decorative by default (aria-hidden); pass aria-hidden={false} + a label via props if it should ever stand alone. */
export function PendingApprovalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" {...props}>
      <circle cx="26" cy="26" r="18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M26 17v9l6.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="42" cy="42" r="10" className="fill-pm-rouge" />
      <path d="m37.5 42 3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckBulletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.35" />
      <path d="m6 10.3 2.6 2.6L14.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/** Circle + cross: "this request was not accepted." Decorative by default. */
export function AccessRefusedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" {...props}>
      <circle cx="28" cy="28" r="18" stroke="currentColor" strokeWidth="1.5" />
      <path d="m22 22 12 12M34 22 22 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Circle + pause bars: "access is on hold." Decorative by default. */
export function AccessSuspendedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" {...props}>
      <circle cx="28" cy="28" r="18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 21v14M32 21v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}
