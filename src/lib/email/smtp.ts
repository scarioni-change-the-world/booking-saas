import nodemailer, { type Transporter } from 'nodemailer';
import { EmailUnavailableError, type EmailProvider, type OutboundEmail } from './provider';

export interface SmtpConfig {
  host: string;
  port: number;
  /** True for implicit TLS (typically port 465); STARTTLS on 587 negotiates
   * its own upgrade and does not set this. */
  secure: boolean;
  user: string;
  password: string;
  /** The product-owned address every email sends from — see provider.ts on
   * why the tenant only ever appears as the display name and Reply-To. */
  fromAddress: string;
}

/**
 * SMTP, not a provider-specific API — see src/lib/email/index.ts for why:
 * this is what a hosting provider's own mailbox (Hostinger or otherwise)
 * actually hands you, so there is exactly one integration to configure,
 * not one now and a different one at deploy time.
 *
 * nodemailer is a real dependency, unlike Calendar and AI's plain fetch()
 * calls — those are simple JSON-over-HTTPS; SMTP is a stateful protocol
 * with its own MIME/attachment/auth handling, and hand-rolling that
 * correctly (malformed MIME is a header-injection risk, not just a bug) is
 * not a reasonable thing to build from scratch for what it would save.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly id = 'smtp';
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(config: SmtpConfig, transporter?: Transporter) {
    this.fromAddress = config.fromAddress;
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
      });
  }

  async send(email: OutboundEmail): Promise<{ id: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${email.fromName}" <${this.fromAddress}>`,
        to: email.to.name ? `"${email.to.name}" <${email.to.email}>` : email.to.email,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { id: info.messageId };
    } catch (cause) {
      // Never thread the provider's own error text into the thrown message —
      // it can echo SMTP auth details or the recipient list back, and this
      // reaches server logs an admin might paste elsewhere. Same posture as
      // anthropic.ts.
      console.error('[email:smtp] send failed:', cause);
      throw new EmailUnavailableError('Could not send email — the mail server refused or was unreachable.');
    }
  }
}
