const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDatabaseConnection } = require('./check-db-ready.js');

test('parses a PostgreSQL connection string into host and port', () => {
  const result = parseDatabaseConnection('postgresql://hr_app:hr_app_local_dev_pw@localhost:5433/hr_system');
  assert.deepEqual(result, { host: 'localhost', port: 5433, database: 'hr_system' });
});

test('uses port 5432 when omitted from the connection string', () => {
  const result = parseDatabaseConnection('postgresql://user:pass@db.example.com/hr_system');
  assert.deepEqual(result, { host: 'db.example.com', port: 5432, database: 'hr_system' });
});
