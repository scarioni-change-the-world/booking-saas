import { describe, expect, it, vi } from 'vitest';
import { SmtpEmailProvider } from '@/lib/email/smtp';
import { EmailUnavailableError } from '@/lib/email/provider';
import type { Transporter } from 'nodemailer';

const CONFIG = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'demo@example.com',
  password: 'super-secret-password',
  fromAddress: 'no-reply@intro.app',
};

function fakeTransporter(impl: (mail: unknown) => Promise<{ messageId: string }>) {
  return { sendMail: vi.fn(impl) } as unknown as Transporter;
}

describe('SmtpEmailProvider', () => {
  it('maps an OutboundEmail onto nodemailer sendMail, tenant on Reply-To', async () => {
    const transporter = fakeTransporter(async () => ({ messageId: 'msg-1' }));
    const provider = new SmtpEmailProvider(CONFIG, transporter);

    const result = await provider.send({
      to: { name: 'Ana Test', email: 'ana@example.com' },
      fromName: 'Demo Coaching',
      replyTo: 'owner@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(result).toEqual({ id: 'msg-1' });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Demo Coaching" <no-reply@intro.app>',
        to: '"Ana Test" <ana@example.com>',
        replyTo: 'owner@example.com',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
  });

  it('sends to a bare address when no display name is given', async () => {
    const transporter = fakeTransporter(async () => ({ messageId: 'msg-1' }));
    const provider = new SmtpEmailProvider(CONFIG, transporter);

    await provider.send({
      to: { email: 'ana@example.com' },
      fromName: 'Demo Coaching',
      subject: 'x',
      html: 'x',
      text: 'x',
    });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com' }),
    );
  });

  it('passes attachments through with their content type', async () => {
    const transporter = fakeTransporter(async () => ({ messageId: 'msg-1' }));
    const provider = new SmtpEmailProvider(CONFIG, transporter);

    await provider.send({
      to: { email: 'ana@example.com' },
      fromName: 'Demo Coaching',
      subject: 'x',
      html: 'x',
      text: 'x',
      attachments: [{ filename: 'invite.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
    });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'invite.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
      }),
    );
  });

  it('throws EmailUnavailableError on failure, without leaking the underlying error text', async () => {
    const transporter = fakeTransporter(async () => {
      throw new Error(`auth failed for user ${CONFIG.user} password ${CONFIG.password}`);
    });
    const provider = new SmtpEmailProvider(CONFIG, transporter);

    try {
      await provider.send({ to: { email: 'ana@example.com' }, fromName: 'x', subject: 'x', html: 'x', text: 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EmailUnavailableError);
      expect((error as Error).message).not.toContain(CONFIG.password);
      expect((error as Error).message).not.toContain(CONFIG.user);
    }
  });
});
