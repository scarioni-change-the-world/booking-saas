/**
 * Website tools: which one a business's site is made with, and how to add
 * the booking page to it in that tool's own words.
 *
 * Most people who run a coaching or photography site do not know what
 * "embed code" means, but they do know which buttons their editor has. So
 * Share finds the tool from the site itself (detectBuilder, fed by a fetch
 * of the home page) and shows only that tool's steps, for the method they
 * chose: a button that links to the booking page, or the booking page as a
 * section of their own page.
 *
 * Pure: no fetching here, so it is testable with a string of HTML.
 */

export type BuilderId = 'squarespace' | 'wix' | 'wordpress' | 'webflow' | 'shopify' | 'framer' | 'other';
export type ShareMethod = 'button' | 'section';

export interface Builder {
  id: BuilderId;
  name: string;
  /** Steps for a "Book now" button that opens the link. */
  button: string[];
  /** Steps for the booking page as a section, with the code. */
  section: string[];
}

const LIVE_CHECK =
  'Check it on your published site, in a private window. Inside the editor the booking page can stay empty: editors show your page from their own address.';

export const BUILDERS: Record<BuilderId, Builder> = {
  squarespace: {
    id: 'squarespace',
    name: 'Squarespace',
    button: [
      'Edit the page, click + where you want the button (or "Add block") and choose "Button".',
      'Type "Book now" (or your own words) as the text.',
      'Under "Link", paste your link, then save.',
    ],
    section: [
      'Edit the page, click + where you want it (or "Add block") and choose "Code".',
      'Paste the code, make sure "HTML" is selected, then click outside the block and save.',
      LIVE_CHECK,
    ],
  },
  wix: {
    id: 'wix',
    name: 'Wix',
    button: [
      'In the editor, click + (Add Elements) → "Button" and drag one onto the page.',
      'Click "Change Text" and type "Book now".',
      'Click the link icon, choose "Web Address", paste your link, choose "New window" or "Current window", then publish.',
    ],
    section: [
      'In the editor, click + (Add Elements) → "Embed Code" → "Embed HTML".',
      'Click "Enter Code", choose "Code", paste the code and click "Update".',
      'Drag the box taller (about 900 px) so the booking page has room, then publish.',
      LIVE_CHECK,
    ],
  },
  wordpress: {
    id: 'wordpress',
    name: 'WordPress',
    button: [
      'Edit the page and add a block (+). Search for "Buttons" and choose it.',
      'Type "Book now", then click the link icon and paste your link.',
      'Update the page.',
    ],
    section: [
      'Edit the page and add a block (+). Search for "Custom HTML" and choose it.',
      'Paste the code and update the page.',
      LIVE_CHECK,
    ],
  },
  webflow: {
    id: 'webflow',
    name: 'Webflow',
    button: [
      'Open the Add panel and drag a "Button" onto the page.',
      'Double-click it and type "Book now".',
      'In the settings panel (the cog), choose "URL", paste your link, then publish.',
    ],
    section: [
      'Open the Add panel and drag a "Code Embed" element onto the page.',
      'Paste the code and click "Save & Close".',
      'Publish the site to see it working: embeds do not run inside the Designer.',
    ],
  },
  shopify: {
    id: 'shopify',
    name: 'Shopify',
    button: [
      'Online Store → Themes → Customize, and open the page where it should go.',
      'Add a "Button" block (inside a section such as "Rich text" or "Image banner").',
      'Type "Book now" as the label, paste your link, then save.',
    ],
    section: [
      'Online Store → Themes → Customize, and open the page where it should go.',
      'Add a section called "Custom Liquid".',
      'Paste the code and save.',
      LIVE_CHECK,
    ],
  },
  framer: {
    id: 'framer',
    name: 'Framer',
    button: [
      'Select a button on your page, or insert one from the Insert menu.',
      'Type "Book now", then in the Link field on the right paste your link.',
      'Publish.',
    ],
    section: [
      'Insert → Utility → "Embed", and drag it onto the page.',
      'Choose "HTML", paste the code, and make the box about 900 px tall.',
      'Publish, then check it on your published site.',
    ],
  },
  other: {
    id: 'other',
    name: 'Another tool',
    button: [
      'Add a button (or select some text) where people should book.',
      'Set its link to your link, and publish.',
    ],
    section: [
      'Look for a block or element called "HTML", "Code", "Embed" or "Custom code".',
      'Paste the code into it and publish.',
      'If your tool has nothing like that, use the "Book now" button instead.',
    ],
  },
};

export const BUILDER_ORDER: BuilderId[] = ['squarespace', 'wix', 'wordpress', 'webflow', 'shopify', 'framer', 'other'];

export function isBuilderId(value: unknown): value is BuilderId {
  return typeof value === 'string' && (BUILDER_ORDER as string[]).includes(value);
}

/**
 * Which tool made this page, from markers each one leaves in its HTML or
 * headers. Ordered most specific first: a Shopify or Wix site can mention
 * WordPress (a blog plugin, a copied snippet), never the other way round.
 */
export function detectBuilder(html: string, headers: Record<string, string> = {}): BuilderId | null {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  const page = html.slice(0, 600_000).toLowerCase();
  const generator = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)/i.exec(html)?.[1]?.toLowerCase() ?? '';

  if (h['x-wix-request-id'] || generator.includes('wix') || page.includes('static.wixstatic.com') || page.includes('static.parastorage.com'))
    return 'wix';
  if (page.includes('static1.squarespace.com') || page.includes('this is squarespace') || generator.includes('squarespace'))
    return 'squarespace';
  if (h['x-shopid'] || h['x-shopify-stage'] || page.includes('cdn.shopify.com') || page.includes('shopify.theme'))
    return 'shopify';
  if (page.includes('data-wf-site') || page.includes('data-wf-page') || generator.includes('webflow')) return 'webflow';
  if (page.includes('framerusercontent.com') || generator.includes('framer') || page.includes('data-framer-')) return 'framer';
  if (generator.includes('wordpress') || page.includes('/wp-content/') || page.includes('/wp-includes/') || h['x-powered-by']?.includes('wp engine'))
    return 'wordpress';
  return null;
}

/**
 * The steps as plain text, for the "email these steps" message: what to
 * add, where, and the exact link or code to paste.
 */
export function stepsAsText(builder: BuilderId, method: ShareMethod, paste: string): string {
  const b = BUILDERS[builder];
  const steps = method === 'button' ? b.button : b.section;
  const what = method === 'button' ? 'Your link' : 'The code';
  return [
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `${what}:`,
    paste,
  ].join('\n');
}
