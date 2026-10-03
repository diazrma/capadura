const path = require('path');
const { createClient } = require('@libsql/client');

const isVercel = process.env.VERCEL === '1';
const hasTurso = Boolean(process.env.TURSO_DATABASE_URL);

if (isVercel && !hasTurso) {
  throw new Error(
    'TURSO_DATABASE_URL não está configurada na Vercel. ' +
    'Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas Environment Variables.'
  );
}

const url = hasTurso
  ? process.env.TURSO_DATABASE_URL
  : `file:${process.env.DB_PATH || path.join(__dirname, 'estante.db')}`;

const client = createClient({
  url,
  ...(process.env.TURSO_AUTH_TOKEN
    ? { authToken: process.env.TURSO_AUTH_TOKEN }
    : {}),
});

const toArgs = (args) => {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0])
  ) {
    return args[0];
  }

  return args;
};

const toObjects = (rs) =>
  rs.rows.map((row) =>
    Object.fromEntries(
      rs.columns.map((column, index) => [column, row[index]])
    )
  );

const run = (sql, args) =>
  client.execute({
    sql,
    args: toArgs(args),
  });

const db = {
  prepare: (sql) => ({
    get: async (...args) => {
      const result = await run(sql, args);
      return toObjects(result)[0];
    },

    all: async (...args) => {
      const result = await run(sql, args);
      return toObjects(result);
    },

    run: async (...args) => {
      const result = await run(sql, args);

      return {
        changes: result.rowsAffected,
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
      };
    },
  }),

  exec: (sql) => client.executeMultiple(sql),

  batch: (statements) =>
    client.batch(
      statements.map(([sql, args = []]) => ({
        sql,
        args,
      })),
      'write'
    ),

  remote: hasTurso,
};

module.exports = db;
