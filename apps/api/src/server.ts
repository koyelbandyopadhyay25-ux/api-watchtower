import 'dotenv/config';
import { createApp } from './app.js';
import { createDatabaseClient } from './database/database-client.js';
import { createMonitoringRepository } from './database/monitoring-repository.js';
import { createMonitoringService } from './monitoring/monitoring-service.js';
import { localManagementEnabled } from './monitoring/management-routes.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const enabled = localManagementEnabled(process.env);
if (enabled && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for local management.');
const database = enabled ? createDatabaseClient(process.env.DATABASE_URL!) : undefined;
const app = createApp({ monitoring: database ? createMonitoringService(createMonitoringRepository(database)) : undefined });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`API Watchtower API listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void database?.$disconnect().catch(() => { process.exitCode = 1; });
    });
  });
}
