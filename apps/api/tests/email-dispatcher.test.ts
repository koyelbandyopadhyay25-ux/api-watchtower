import { describe, expect, it, vi } from 'vitest';
import { createEmailDispatcher } from '../src/notifications/email-dispatcher.js';
import { EmailDeliveryError } from '../src/notifications/delivery-policy.js';
import { emailJob } from './helpers/email-job.js';
function fixture() {
  const jobs = [emailJob(), { ...emailJob(), eventId: 'other' }];
  const repository = { claim: vi.fn(async () => jobs.shift() ?? null), allowed: vi.fn(async () => true), complete: vi.fn(async () => true) };
  const send = vi.fn(async () => {}), log = vi.fn();
  return { repository, send, log, worker: createEmailDispatcher(repository, send, log, 1) };
}
describe('separate bounded email dispatcher', () => {
  it('sends only after claim and acknowledgement records SMTP acceptance', async () => {
    const f = fixture(); await f.worker.tick();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.repository.complete).toHaveBeenCalledWith(expect.anything(), { kind: 'accepted' });
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'email_smtp_accepted' }));
  });
  it('does not send cancelled or no-longer-owned work', async () => {
    const f = fixture(); f.repository.allowed.mockResolvedValue(false); await f.worker.tick();
    expect(f.send).not.toHaveBeenCalled(); expect(f.repository.complete).toHaveBeenCalledWith(expect.anything(), { kind: 'cancelled' });
  });
  it('preserves safe retry classifications without logging exceptions or bodies', async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(new EmailDeliveryError('smtp_timeout', true)); await f.worker.tick();
    expect(f.repository.complete).toHaveBeenCalledWith(expect.anything(), { kind: 'failed', code: 'smtp_timeout', retryable: true });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('password'); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('keeps ambiguous acknowledgements for lease recovery instead of reporting delivery', async () => {
    const f = fixture(); f.repository.complete.mockRejectedValue(new Error('private driver detail')); await f.worker.tick();
    expect(f.log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'email_smtp_accepted' }));
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('private driver detail');
  });
  it('does not claim success for a lost lease', async () => {
    const f = fixture(); f.repository.complete.mockResolvedValue(false); await f.worker.tick();
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'email_ack_lost' }));
  });
  it('never overlaps ticks and drains admitted sends on shutdown', async () => {
    const f = fixture(); let release!: () => void;
    f.send.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    f.repository.claim.mockResolvedValueOnce(emailJob()).mockResolvedValue(null);
    const controller = new AbortController(); const running = f.worker.run(controller.signal);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    await f.worker.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(2);
    controller.abort(); release(); await running;
    expect(f.repository.complete).toHaveBeenCalledWith(expect.anything(), { kind: 'accepted' });
  });
  it('refuses new work after shutdown and survives claim failures', async () => {
    const f = fixture(); const stopped = new AbortController(); stopped.abort(); await f.worker.tick(stopped.signal);
    expect(f.repository.claim).not.toHaveBeenCalled();
    f.repository.claim.mockRejectedValueOnce(new Error('private connection detail')); await f.worker.tick();
    expect(f.log).toHaveBeenCalledWith({ event: 'email_claim_failed' });
  });
});
