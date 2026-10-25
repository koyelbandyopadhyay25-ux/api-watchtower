import 'dotenv/config';
import { createDatabaseClient } from './database-client.js';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = createDatabaseClient(connectionString);
  try {
    const rows = await client.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`;
    if (rows[0]?.value !== 1) throw new Error('Unexpected database response.');
    console.log('Database connection verified: SELECT 1 succeeded.');
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error('Database verification failed. Check the local server and DATABASE_URL. No credentials are logged.');
  process.exitCode = 1;
});
