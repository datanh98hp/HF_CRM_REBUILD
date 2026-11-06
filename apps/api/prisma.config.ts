import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const configDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
loadDotEnv({ path: resolve(configDirectory, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Client generation does not need a live database; provide a local-only
    // placeholder when DATABASE_URL is absent. Runtime config still requires it.
    url:
      process.env.DATABASE_URL ??
      'postgresql://local:local@127.0.0.1:5432/finance_crm?schema=public',
  },
});
