import 'dotenv/config';
import { createDatabaseClient } from '../database/database-client.js';
import { createMonitoringRepository } from '../database/monitoring-repository.js';
import { createMonitoringService } from '../monitoring/monitoring-service.js';
import { createMonitoringWorker } from './monitoring-worker.js';
import { workerConnectionString } from './worker-config.js';

async function main() {
  const database = createDatabaseClient(workerConnectionString(process.env));
  const stop = new AbortController();
  const shutdown = () => { console.log(JSON.stringify({ event: 'worker_stopping' })); stop.abort(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    const repository = createMonitoringRepository(database);
    // Actual queries: do not announce an active worker before DB/schema verification.
    await repository.databaseTime();
    await repository.dueSchedules(1);
    await database.scheduledCheck.count();
    const worker = createMonitoringWorker(repository, createMonitoringService(repository), event => console.log(JSON.stringify(event)));
    console.log(JSON.stringify({ event: 'worker_started', pollSeconds: 5, maxConcurrentChecks: 3 }));
    if (process.argv.includes('--once')) await worker.tick(stop.signal);
    else await worker.run(stop.signal);
  } finally {
    stop.abort();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await database.$disconnect();
    console.log(JSON.stringify({ event: 'worker_stopped' }));
  }
}

main().catch(() => {
  console.error('Worker could not start or stop cleanly. Verify local opt-in settings, PostgreSQL, and the approved scheduling migration. No credentials or responses are logged.');
  process.exitCode = 1;
});
