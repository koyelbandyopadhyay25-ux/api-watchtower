import { connect, type Socket } from 'node:net';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { EMAIL_LIMITS, EmailDeliveryError } from './delivery-policy.js';
import { notificationMessage } from './email-template.js';
import type { EmailJob } from './outbox-repository.js';

export function emailDispatcherConnectionString(environment: NodeJS.ProcessEnv) {
  if (environment.NODE_ENV !== 'development' || environment.ENABLE_EMAIL_DISPATCHER !== 'true' || environment.EMAIL_DELIVERY_MODE !== 'mailpit' ||
    (environment.MAILPIT_SMTP_HOST !== undefined && environment.MAILPIT_SMTP_HOST !== '127.0.0.1') ||
    (environment.MAILPIT_SMTP_PORT !== undefined && environment.MAILPIT_SMTP_PORT !== '1025') || !environment.DATABASE_URL) throw new Error('Email dispatcher requires explicit local Mailpit opt-in.');
  const url = new URL(environment.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['/watchtower_dev', '/watchtower_test'].includes(url.pathname) || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
    (url.pathname === '/watchtower_test' && environment.TEST_DATABASE_DISPOSABLE !== 'true')) throw new Error('Email dispatcher requires a dedicated local database.');
  return environment.DATABASE_URL;
}

/** Literal loopback socket, fixed test-domain envelope, no credentials or external SMTP options. */
export async function sendToMailpit(job: EmailJob): Promise<void> {
  let message: ReturnType<typeof notificationMessage>;
  try { message = notificationMessage(job); if (Buffer.byteLength(message.text) > 16_384) throw new Error(); }
  catch { throw new EmailDeliveryError('invalid_message', false); }
  let socket: Socket | undefined;
  let expired = false;
  const transport = nodemailer.createTransport({
    host: '127.0.0.1', port: 1025, secure: false, ignoreTLS: true, pool: false, name: 'localhost',
    connectionTimeout: 3000, greetingTimeout: 2000, socketTimeout: 5000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    getSocket(_options, callback) {
      let called = false;
      const done = (error: Error | null) => { if (!called) { called = true; callback(error, error ? {} : { connection: socket }); } };
      socket = connect({ host: '127.0.0.1', port: 1025 });
      socket.setTimeout(3000, () => socket?.destroy(Object.assign(new Error('smtp_connect_timeout'), { code: 'ETIMEDOUT' })));
      socket.once('connect', () => { socket?.setTimeout(0); done(null); }); socket.once('error', error => done(error));
    },
  } satisfies SMTPTransport.Options);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; socket?.destroy(new Error('smtp_deadline')); transport.close(); reject(new EmailDeliveryError('smtp_timeout', true)); }, EMAIL_LIMITS.sendMs);
  });
  try {
    const info = await Promise.race([transport.sendMail({ ...message, envelope: { from: 'watchtower@example.test', to: [message.to] } }), deadline]);
    if (!info.accepted.includes(message.to)) throw new EmailDeliveryError('smtp_rejected', false);
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    const responseCode = error && typeof error === 'object' && 'responseCode' in error ? Number(error.responseCode) : 0;
    const timedOut = expired || (error && typeof error === 'object' && 'code' in error && error.code === 'ETIMEDOUT');
    throw new EmailDeliveryError(timedOut ? 'smtp_timeout' : responseCode >= 500 ? 'smtp_rejected' : 'smtp_unavailable', responseCode < 500);
  } finally { clearTimeout(timer!); socket?.destroy(); transport.close(); }
}
