import { describe, expect, it } from 'vitest';
import { BUILDERS, BUILDER_ORDER, detectBuilder, stepsAsText } from '@/lib/builders';

describe('detectBuilder', () => {
  it('recognises each tool from what it leaves in the page', () => {
    expect(detectBuilder('<link href="https://static1.squarespace.com/static/x.css">')).toBe('squarespace');
    expect(detectBuilder('<!-- This is Squarespace. -->')).toBe('squarespace');
    expect(detectBuilder('<meta name="generator" content="Wix.com Website Builder">')).toBe('wix');
    expect(detectBuilder('<img src="https://static.wixstatic.com/media/a.jpg">')).toBe('wix');
    expect(detectBuilder('<html></html>', { 'X-Wix-Request-Id': 'abc' })).toBe('wix');
    expect(detectBuilder('<meta name="generator" content="WordPress 6.6">')).toBe('wordpress');
    expect(detectBuilder('<link href="/wp-content/themes/x/style.css">')).toBe('wordpress');
    expect(detectBuilder('<html data-wf-site="123" data-wf-page="456">')).toBe('webflow');
    expect(detectBuilder('<script src="https://cdn.shopify.com/s/files/x.js"></script>')).toBe('shopify');
    expect(detectBuilder('<img src="https://framerusercontent.com/images/a.png">')).toBe('framer');
  });

  it('prefers the tool over a stray WordPress mention', () => {
    expect(detectBuilder('<script src="https://cdn.shopify.com/a.js"></script><a href="/wp-content/x">')).toBe('shopify');
  });

  it('says nothing when it cannot tell', () => {
    expect(detectBuilder('<html><body>Hello</body></html>')).toBeNull();
  });
});

describe('steps', () => {
  it('has both methods for every tool', () => {
    for (const id of BUILDER_ORDER) {
      expect(BUILDERS[id].button.length).toBeGreaterThan(0);
      expect(BUILDERS[id].section.length).toBeGreaterThan(0);
    }
  });

  it('writes the steps out with the thing to paste', () => {
    const text = stepsAsText('wordpress', 'button', 'https://app.khloe.io/mara');
    expect(text).toMatch(/^1\. /);
    expect(text).toContain('Your link:\nhttps://app.khloe.io/mara');
    expect(stepsAsText('wix', 'section', '<iframe>')).toContain('The code:\n<iframe>');
  });
});
