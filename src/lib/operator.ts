/**
 * Who runs khloe, as the legal pages (privacy, terms) state it. Keep it
 * current: Google's review and the GDPR both read it.
 */
export const OPERATOR = {
  legalName: 'Andrés Scarioni',
  address: 'C/ Adolf Vázquez Humasqué, 3, 1-A, 07015 Palma de Mallorca',
  /** General questions and support. */
  contactEmail: 'hello@khloe.io',
  /** Requests about personal data (see, correct, delete): the privacy page's address. */
  privacyEmail: 'privacy@khloe.io',
  /** The country whose data-protection authority supervises khloe. */
  jurisdiction: 'Spain',
  /** That authority, named and linked, so a complaint does not start with a search. */
  authority: { name: 'Agencia Española de Protección de Datos (AEPD)', url: 'https://www.aepd.es' },
};

/** The website the legal pages are linked from. Set at build time; without it, / is the best there is. */
export const WEBSITE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/+$/, '') || '/';
