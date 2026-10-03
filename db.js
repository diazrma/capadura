// Acesso ao banco: Turso (libSQL) na nuvem, ou o arquivo SQLite local quando não há TURSO_DATABASE_URL.
// Mantém a mesma "cara" do node:sqlite (db.prepare(sql).get/all/run), só que assíncrona:
//   const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const path = require('path');
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH || path.join(__dirname, 'estante.db')}`;
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// Um único objeto de parâmetros nomeados ({ me: 1 }) ou a lista posicional
const toArgs = (args) => (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : args);

// Linha como objeto simples; com colunas repetidas, vale a última (igual ao node:sqlite)
const toObjects = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));

const run = (sql, args) => client.execute({ sql, args: toArgs(args) });

const db = {
  prepare: (sql) => ({
    get: async (...args) => toObjects(await run(sql, args))[0],
    all: async (...args) => toObjects(await run(sql, args)),
    run: async (...args) => {
      const rs = await run(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
  }),
  exec: (sql) => client.executeMultiple(sql),
  // várias escritas de uma vez, tudo ou nada (substitui BEGIN/COMMIT)
  batch: (statements) => client.batch(statements.map(([sql, args = []]) => ({ sql, args })), 'write'),
  remote: Boolean(process.env.TURSO_DATABASE_URL),
};

module.exports = db;
