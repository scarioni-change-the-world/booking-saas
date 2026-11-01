import { emailProvider } from './email';
import { renderTemplate } from './email/templates';
import type { EmailStatus } from './db/types';

/**
 * Share → "Email these steps": khloe writing to whoever looks after a
 * business's website, on the business's behalf. Fixed wording, replies go
 * to the person who sent it, and a send that reports rather than throws
 * (like signup-email.ts).
 */
export async function sendShareStepsEmail(input: {
  to: string;
  business: string;
  replyTo: string | null;
  tool: string;
  method: 'button' | 'section';
  steps: string;
  link: string;
}): Promise<Exclude<EmailStatus, 'pending'>> {
  const provider = emailProvider();
  if (provider.id === 'console') return 'not_configured';
  const what =
    input.method === 'button'
      ? 'a “Book now” button on the website that opens their booking page'
      : 'their booking page on the website, as a section of a page';
  try {
    const rendered = renderTemplate(
      {
        subject: 'Adding {{business}}’s booking page to the website',
        body:
          'Hello,\n\n' +
          '{{business}} takes bookings with khloe, and would like {{what}}. ' +
          'It takes a couple of minutes. These are the steps for {{tool}}:\n\n' +
          '{{steps}}\n\n' +
          'To see the booking page on its own: {{link}}\n\n' +
          'Reply to this email to reach {{business}}.',
      },
      { business: input.business, what, tool: input.tool, steps: input.steps, link: input.link },
    );
    await provider.send({
      to: { email: input.to },
      fromName: `${input.business} via khloe`,
      replyTo: input.replyTo ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return 'sent';
  } catch (cause) {
    console.error('[share] could not send steps:', cause);
    return 'failed';
  }
}
