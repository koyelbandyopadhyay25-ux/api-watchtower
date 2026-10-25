import express from 'express';

// Separate the app from the listener so tests do not start a persistent server.
export const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'api-watchtower' });
});
