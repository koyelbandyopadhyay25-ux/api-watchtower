import express from 'express';
import { localManagementEnabled, managementRoutes } from './monitoring/management-routes.js';
import type { MonitoringService } from './monitoring/monitoring-service.js';

// Separate the app from the listener so tests do not start a persistent server.
export function createApp(options: { monitoring?: MonitoringService; environment?: NodeJS.ProcessEnv } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'api-watchtower' });
  });
  const environment = options.environment ?? process.env;
  if (options.monitoring && localManagementEnabled(environment)) {
    app.use('/api', managementRoutes(options.monitoring, environment.PORT));
  }
  return app;
}

export const app = createApp();
