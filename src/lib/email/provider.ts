/**
 * Email provider interface (brief 7.5).
 *
 * The reference implementation sent through one Workspace SMTP account. That
 * cannot survive multi-tenancy: deliverability collapses and sending as
 * hundreds of businesses from one mailbox is a spoofing problem. The shape here
 * is the one the brief prescribes — a product-owned sending domain by default,
 * with the tenant on Reply-To, and room for a per-tenant verified domain later
 * as a paid feature.
 */

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface OutboundEmail {
  to: EmailAddress;
  /** Display name is the tenant's; the address stays product-owned by default. */
  fromName: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  readonly id: string;
  send(email: OutboundEmail): Promise<{ id: string }>;
}
