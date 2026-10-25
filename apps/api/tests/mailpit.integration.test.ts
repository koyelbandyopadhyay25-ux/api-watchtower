import { expect, it } from 'vitest';
import { sendToMailpit } from '../src/notifications/mailpit-sender.js';
import { emailJob } from './helpers/email-job.js';

// Explicitly opt in with a local capture server running; no database or external recipient.
it.skipIf(process.env.WATCHTOWER_MAILPIT_TEST !== 'true')('submits a test-only fixture to actual local Mailpit SMTP (not real inbox delivery)', async () => {
  await expect(sendToMailpit(emailJob())).resolves.toBeUndefined();
});
