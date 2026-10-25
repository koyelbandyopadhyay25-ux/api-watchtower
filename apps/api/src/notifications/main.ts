import 'dotenv/config';
import { createDatabaseClient } from '../database/database-client.js';
import { createOutboxRepository } from './outbox-repository.js';
import { emailDispatcherConnectionString, sendToMailpit } from './mailpit-sender.js';
import { createEmailDispatcher } from './email-dispatcher.js';

async function main() {
  const client = createDatabaseClient(emailDispatcherConnectionString(process.env));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await client.emailOutbox.count(); await client.emailAttempt.count();
    const dispatcher = createEmailDispatcher(createOutboxRepository(client), sendToMailpit, event => console.log(JSON.stringify(event)));
    console.log(JSON.stringify({ event: 'email_dispatcher_started', mode: 'local_mailpit_only' }));
    if (process.argv.includes('--once')) await dispatcher.tick(controller.signal);
    else await dispatcher.run(controller.signal);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await client.$disconnect(); console.log(JSON.stringify({ event: 'email_dispatcher_stopped' }));
  }
}
main().catch(() => { console.error('Email dispatcher unavailable. Verify explicit Mailpit opt-in, local PostgreSQL and approved migrations. No credentials or messages logged.'); process.exitCode = 1; });
