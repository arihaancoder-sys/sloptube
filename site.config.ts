// The owner's details for the public pages (/about, /terms, /privacy,
// /guidelines, /press, /contact), the footer and the share cards.
//
// Fill these in before you open your sloptube to the public. Nothing here is
// secret: it all shows on the site. Until a value is changed, the pages show
// the placeholder in capitals so a missing detail is easy to spot.
//
// No imports on purpose, so `node --test` can load it directly.

export const siteConfig = {
  /** The site's name in titles, share cards and the footer. */
  siteName: "sloptube",
  /** The person or organization that runs this copy of sloptube, as it should appear in the terms. */
  ownerName: "OWNER_NAME",
  /** Where people (and the press) can write. Also shown on /contact next to the form. */
  contactEmail: "CONTACT_EMAIL",
  /** The country or state whose law the terms follow, like "Germany" or "California, USA". */
  jurisdiction: "JURISDICTION",
  /** The date the terms and the privacy notice last changed, shown at the top of both. */
  legalUpdated: "LEGAL_UPDATED",
  /** One line about the site, for share cards and search results. */
  description: "A video platform, built in the open one feature at a time.",
  /** The source code, linked from the footer and /about. */
  sourceUrl: "https://github.com/myfilehero/sloptube",
} as const;

export type SiteConfig = typeof siteConfig;

/** True while a value is still the placeholder, so the pages can mark it. */
export function isPlaceholder(value: string): boolean {
  return /^[A-Z_]+$/.test(value);
}
