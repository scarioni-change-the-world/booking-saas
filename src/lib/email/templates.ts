import type { EmailTemplateKind } from '../db/types';

/**
 * Turning a tenant's own plain-text template into the email actually sent.
 *
 * The template (subject + body) is tenant-authored, editable content — the
 * same posture as outcome_paths.message (migration 0011): plain text, not
 * HTML, so there's nothing in it that can break the layout or need an
 * html/text version kept in sync by hand.
 *
 * One thing is never left to the template: the link an email exists to
 * carry is appended after the tenant's own words, always, regardless of
 * what they wrote. A tenant customising the tone of their confirmation
 * email is a feature; a tenant accidentally deleting the only way a client
 * can cancel is a support ticket. Two kinds use this — a booking's manage
 * link (confirmed/rescheduled), and a client's own private booking link
 * (client_invite, migration 0020), where the argument is stronger still: a
 * confirmation missing its manage link is still a confirmation, but an
 * invite missing its link is nothing at all. Everything else — the client's
 * name, the service, the time, the meeting link — is a {{token}} the tenant
 * places in their own prose, because losing one of those is a cosmetic gap,
 * not a broken feature.
 */

export const TEMPLATE_TOKENS: Record<EmailTemplateKind, string[]> = {
  booking_confirmed: ['clientName', 'serviceName', 'dateTime', 'meetingLink', 'tenantName'],
  booking_rescheduled: ['clientName', 'serviceName', 'dateTime', 'tenantName'],
  booking_cancelled: ['clientName', 'serviceName', 'dateTime', 'tenantName'],
  owner_notification: ['clientName', 'clientEmail', 'serviceName', 'dateTime', 'tenantName'],
  // No booking exists yet when this one is sent, so none of the tokens that
  // describe one do either. The link itself is deliberately not a token —
  // see the module comment above and renderTemplate's linkLine.
  client_invite: ['clientName', 'tenantName'],
};

export type TemplateTokens = Record<string, string>;

/**
 * Substitute {{token}} placeholders. An unrecognised token is left exactly
 * as written rather than rejected at save time or silently dropped — a
 * literal "{{typo}}" showing up in a sent test email is a visible,
 * self-diagnosing mistake, which is friendlier than a save that fails for
 * a reason the tenant has to guess at.
 */
function substitute(template: string, tokens: TemplateTokens): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in tokens ? tokens[key]! : match,
  );
}

/** The five characters that matter inside an HTML text node or attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render one tenant template into a subject/html/text triple.
 *
 * Escaping order matters and is worth spelling out: the tenant's raw body
 * (which may itself contain `<`, `&`, or literal `{{...}}`-looking text
 * that isn't actually a token) is HTML-escaped *before* token substitution,
 * and each token's own value is escaped independently before it's spliced
 * in — so a client named "Rí<script>" ends up as inert text in the HTML
 * version, not markup. The plain-text version skips escaping entirely: it
 * has no markup to break, so escaping it would just show literal "&amp;"s.
 *
 * `linkLine`, appended after the tenant's own body when given, is the one
 * piece of content this function adds on its own — see the module comment
 * above for why that line is never left to the template.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  tokens: TemplateTokens,
  linkLine?: { label: string; url: string },
): RenderedTemplate {
  const subject = substitute(template.subject, tokens);

  const escapedTokens: TemplateTokens = {};
  for (const [key, value] of Object.entries(tokens)) escapedTokens[key] = escapeHtml(value);

  const escapedBody = escapeHtml(template.body);
  const htmlBody = substitute(escapedBody, escapedTokens).replace(/\n/g, '<br>\n');
  const textBody = substitute(template.body, tokens);

  const htmlFooter = linkLine
    ? `<p style="margin-top:24px;"><a href="${escapeHtml(linkLine.url)}">${escapeHtml(linkLine.label)}</a></p>`
    : '';
  const textFooter = linkLine ? `\n\n${linkLine.label}: ${linkLine.url}` : '';

  return {
    subject,
    html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${htmlBody}${htmlFooter}</div>`,
    text: `${textBody}${textFooter}`,
  };
}
