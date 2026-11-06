export function redisConnectionOptions(redisUrl: string, maxRetriesPerRequest: number | null) {
  const url = new URL(redisUrl);
  const options: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    maxRetriesPerRequest: number | null;
    tls?: Record<string, never>;
  } = {
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'rediss:' ? 6380 : 6379,
    maxRetriesPerRequest,
  };

  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const database = url.pathname.replace(/^\//, '');
  if (database) {
    const databaseNumber = Number(database);
    if (!Number.isInteger(databaseNumber) || databaseNumber < 0) {
      throw new Error('REDIS_URL path must be a non-negative database number');
    }
    options.db = databaseNumber;
  }
  if (url.protocol === 'rediss:') options.tls = {};

  return options;
}
