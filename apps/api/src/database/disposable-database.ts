type DatabasePurpose = 'development' | 'test';

export class DatabaseSafetyError extends Error {}

/** Naming and localhost guards supplement, but cannot replace, explicit consent. */
export function assertDisposableDatabase(
  connectionString: string | undefined,
  purpose: DatabasePurpose,
  confirmed: string | undefined,
): string {
  if (process.env.NODE_ENV === 'production' || confirmed !== 'true' || !connectionString) {
    throw new DatabaseSafetyError('A confirmed disposable local database is required.');
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseSafetyError('Invalid local database configuration.');
  }
  const expectedName = purpose === 'test' ? 'watchtower_test' : 'watchtower_dev';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== `/${expectedName}` ||
      [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) {
    throw new DatabaseSafetyError(`Only a local ${expectedName} database with the public schema is allowed.`);
  }
  return connectionString;
}
