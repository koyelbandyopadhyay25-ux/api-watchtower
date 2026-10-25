import { afterEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendToMailpit } from '../src/notifications/mailpit-sender.js';
import { emailJob, emailOwner } from './helpers/email-job.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
afterEach(() => vi.useRealTimers());
function fixture() {
  const sendMail = vi.fn(async (_message: unknown) => ({ accepted: [`watchtower+${emailOwner}@example.test`] })), close = vi.fn();
  vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as unknown as ReturnType<typeof nodemailer.createTransport>);
  return { sendMail, close };
}
describe('Mailpit-only Nodemailer sender', () => {
  it('uses a fixed loopback socket policy, test-domain envelope and plain text only', async () => {
    const f = fixture(); await sendToMailpit(emailJob());
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 1025, secure: false, ignoreTLS: true, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true }));
    expect(f.sendMail).toHaveBeenCalledWith(expect.objectContaining({ envelope: { from: 'watchtower@example.test', to: [`watchtower+${emailOwner}@example.test`] }, text: expect.any(String) }));
    expect(f.sendMail.mock.calls[0]?.[0]).not.toHaveProperty('html');
  });
  it('categorizes temporary and permanent SMTP failures safely', async () => {
    const f = fixture(); f.sendMail.mockRejectedValueOnce({ responseCode: 451, message: 'private smtp text' });
    await expect(sendToMailpit(emailJob())).rejects.toMatchObject({ code: 'smtp_unavailable', retryable: true });
    f.sendMail.mockRejectedValueOnce({ responseCode: 550, message: 'private smtp text' });
    await expect(sendToMailpit(emailJob())).rejects.toMatchObject({ code: 'smtp_rejected', retryable: false });
    f.sendMail.mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'private smtp text' });
    await expect(sendToMailpit(emailJob())).rejects.toMatchObject({ code: 'smtp_timeout', retryable: true });
  });
  it('enforces an absolute eight-second deadline even if a transport never resolves', async () => {
    vi.useFakeTimers(); const f = fixture(); f.sendMail.mockImplementation(() => new Promise(() => {}));
    const result = expect(sendToMailpit(emailJob())).rejects.toMatchObject({ code: 'smtp_timeout', retryable: true });
    await vi.advanceTimersByTimeAsync(8000); await result; expect(f.close).toHaveBeenCalled();
  });
  it('does not report acceptance if the expected envelope recipient was not accepted', async () => {
    fixture().sendMail.mockResolvedValueOnce({ accepted: [] });
    await expect(sendToMailpit(emailJob())).rejects.toMatchObject({ code: 'smtp_rejected', retryable: false });
  });
});
