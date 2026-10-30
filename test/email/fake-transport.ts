import type { MailMessage, MailTransport } from '../../src/email/transport.ts';

/** Records every message; `failures` makes the next that many sends throw. */
export class FakeTransport implements MailTransport {
  sent: MailMessage[] = [];
  attempts = 0;
  failures = 0;
  async send(message: MailMessage): Promise<void> {
    this.attempts++;
    if (this.failures > 0) {
      this.failures--;
      throw new Error('SMTP down');
    }
    this.sent.push(message);
  }
}
