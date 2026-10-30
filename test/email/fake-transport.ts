import type { Db } from '../../src/db/db.ts';
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

/** Marks a day as already sent, so a test about one day is not disturbed by the empty day before it. */
export function markSent(db: Db, date: string): void {
  db.prepare("INSERT INTO email_odoslanie (den, cas, prijemcovia, ok) VALUES (?, 0, '[]', 1)").run(date);
}
