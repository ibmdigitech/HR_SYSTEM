const fs = require('fs');
const net = require('net');
const path = require('path');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function parseDatabaseConnection(connectionString) {
  if (!connectionString) {
    throw new Error('No database connection string was provided.');
  }

  const url = new URL(connectionString);
  const database = (url.pathname || '/').replace(/^\/+/, '') || null;

  return {
    host: url.hostname || 'localhost',
    port: Number(url.port || 5432),
    database,
  };
}

function resolveDatabaseUrl() {
  const env = loadDotEnv(path.join(__dirname, '..', '.env'));
  return (
    process.env.DATABASE_URL ||
    process.env.DIRECT_URL ||
    env.DATABASE_URL ||
    env.DIRECT_URL ||
    ''
  );
}

function main() {
  const connectionString = resolveDatabaseUrl();

  if (!connectionString) {
    console.error('[db-check] DATABASE_URL is missing from the environment or .env file.');
    process.exit(1);
  }

  let target;
  try {
    target = parseDatabaseConnection(connectionString);
  } catch (error) {
    console.error('[db-check] Invalid DATABASE_URL format:', connectionString);
    console.error(error.message);
    process.exit(1);
  }

  const { host, port, database } = target;
  const timeoutMs = Number(process.env.CHECK_DB_TIMEOUT_MS || 5000);

  console.log(`[db-check] Checking PostgreSQL connectivity at ${host}:${port}/${database || 'unknown'}...`);

  const socket = net.createConnection({ host, port }, () => {
    console.log('[db-check] PostgreSQL is reachable.');
    socket.destroy();
    process.exit(0);
  });

  socket.setTimeout(timeoutMs);

  socket.on('timeout', () => {
    console.error(`[db-check] PostgreSQL timed out after ${timeoutMs}ms at ${host}:${port}.`);
    console.error('[db-check] Start the database container or update DATABASE_URL/DIRECT_URL to a reachable instance.');
    socket.destroy();
    process.exit(1);
  });

  socket.on('error', (error) => {
    console.error(`[db-check] PostgreSQL is not reachable at ${host}:${port}.`);
    console.error(`[db-check] Connection failed: ${error.code || 'ECONNREFUSED'} - ${error.message}`);
    console.error('[db-check] Start the database container, then rerun the app.');
    process.exit(1);
  });
}

module.exports = {
  parseDatabaseConnection,
  resolveDatabaseUrl,
  loadDotEnv,
};

if (require.main === module) {
  main();
}
