import nodemailer from 'nodemailer';
import type { SmtpConfig } from '../config.ts';

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: Uint8Array; contentType: string }[];
}

/** The seam to the mail server: production uses SMTP, tests record the messages. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export function createSmtpTransport(smtp: SmtpConfig): MailTransport {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  return {
    async send(m) {
      await transporter.sendMail({ from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text, attachments: m.attachments.map((a) => ({ ...a, content: Buffer.from(a.content) })) });
    },
  };
}
