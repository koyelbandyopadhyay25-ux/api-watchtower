export function workerConnectionString(environment: NodeJS.ProcessEnv): string {
  if (environment.NODE_ENV !== 'development' || environment.ENABLE_SCHEDULER_WORKER !== 'true' || !environment.DATABASE_URL) {
    throw new Error('Worker disabled. Require NODE_ENV=development, ENABLE_SCHEDULER_WORKER=true and a local DATABASE_URL.');
  }
  const url = new URL(environment.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['/watchtower_dev', '/watchtower_test'].includes(url.pathname) ||
      [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
      (url.pathname === '/watchtower_test' && environment.TEST_DATABASE_DISPOSABLE !== 'true')) {
    throw new Error('Worker requires the dedicated local development database or a confirmed isolated test database.');
  }
  return environment.DATABASE_URL;
}
