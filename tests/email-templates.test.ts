import { describe, expect, it } from 'vitest';
import { escapeHtml, renderTemplate, TEMPLATE_TOKENS } from '@/lib/email/templates';

describe('renderTemplate', () => {
  it('substitutes tokens in subject, html and text', () => {
    const result = renderTemplate(
      { subject: 'Hi {{clientName}}', body: 'See you {{dateTime}}, {{clientName}}.' },
      { clientName: 'Ana', dateTime: 'Jan 15, 9:00am' },
    );
    expect(result.subject).toBe('Hi Ana');
    expect(result.text).toBe('See you Jan 15, 9:00am, Ana.');
    expect(result.html).toContain('See you Jan 15, 9:00am, Ana.');
  });

  it('leaves an unrecognised token exactly as written, rather than dropping it', () => {
    const result = renderTemplate({ subject: 'Hi {{typo}}', body: 'x' }, { clientName: 'Ana' });
    expect(result.subject).toBe('Hi {{typo}}');
  });

  it('HTML-escapes a token value in the html output but not the text output', () => {
    const result = renderTemplate(
      { subject: 'x', body: 'Hello {{clientName}}' },
      { clientName: '<script>alert(1)</script>' },
    );
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
    // The text version has no markup to protect, so it carries the raw value.
    expect(result.text).toContain('<script>alert(1)</script>');
  });

  it('HTML-escapes literal markup in the tenant-authored body itself', () => {
    const result = renderTemplate({ subject: 'x', body: 'Use < and > freely' }, {});
    expect(result.html).toContain('&lt; and &gt;');
    expect(result.html).not.toContain('Use < and >');
  });

  it('converts newlines to <br> in html but keeps them literal in text', () => {
    const result = renderTemplate({ subject: 'x', body: 'Line one\nLine two' }, {});
    expect(result.html).toContain('Line one<br>\nLine two');
    expect(result.text).toBe('Line one\nLine two');
  });

  it('appends the manage link after the body when given, in both html and text', () => {
    const result = renderTemplate(
      { subject: 'x', body: 'Body text' },
      {},
      { label: 'Change or cancel', url: 'https://example.com/manage/abc' },
    );
    expect(result.text).toContain('Change or cancel: https://example.com/manage/abc');
    expect(result.html).toContain('https://example.com/manage/abc');
    expect(result.html).toContain('Change or cancel');
  });

  it('omits the manage link entirely when not given', () => {
    const result = renderTemplate({ subject: 'x', body: 'Body text' }, {});
    expect(result.text).toBe('Body text');
    expect(result.html).not.toContain('<a href');
  });

  it('every kind that describes a booking can name that booking', () => {
    // client_invite is the one kind no booking triggers — it carries a
    // client's private link (migration 0020), and there is no service or
    // time to name at the point it's sent. Excluded by name, rather than by
    // loosening what every other kind is held to.
    const bookingKinds = (Object.keys(TEMPLATE_TOKENS) as Array<keyof typeof TEMPLATE_TOKENS>).filter(
      (kind) => kind !== 'client_invite',
    );

    expect(bookingKinds.length).toBeGreaterThan(0);
    for (const kind of bookingKinds) {
      expect(TEMPLATE_TOKENS[kind]).toContain('clientName');
      expect(TEMPLATE_TOKENS[kind]).toContain('serviceName');
      expect(TEMPLATE_TOKENS[kind]).toContain('dateTime');
    }
  });

  it('addresses the client by name in every kind, booking or not', () => {
    for (const kind of Object.keys(TEMPLATE_TOKENS) as Array<keyof typeof TEMPLATE_TOKENS>) {
      expect(TEMPLATE_TOKENS[kind]).toContain('clientName');
    }
  });

  // An invite's whole reason for existing is the link, so it arrives on the
  // same always-appended line a manage link does — never as a {{token}} a
  // tenant could delete while rewriting their copy.
  it('carries a client invite’s booking link even when the tenant rewrote the body', () => {
    const result = renderTemplate(
      { subject: 'Your link', body: 'Hi {{clientName}}, welcome back.' },
      { clientName: 'Ana', tenantName: 'Demo Coaching' },
      { label: 'Book a session', url: 'https://example.com/t/demo/client/tok123' },
    );

    expect(result.text).toContain('Hi Ana, welcome back.');
    expect(result.text).toContain('Book a session: https://example.com/t/demo/client/tok123');
    expect(result.html).toContain('https://example.com/t/demo/client/tok123');
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
});
