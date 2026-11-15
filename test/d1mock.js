// D1-compatible shim over node:sqlite (in-memory). Implements only the query
// surface the worker uses: prepare(sql).bind(...).first(col?) / .run()
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function makeDB() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(import.meta.dirname, "..", "schema.sql"), "utf8"));
  const api = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first(col) {
              const row = db.prepare(sql).get(...params) ?? null;
              if (!row) return null;
              return col ? row[col] : row;
            },
            async run() {
              const r = db.prepare(sql).run(...params);
              return { changes: Number(r.changes), results: null };
            },
          };
        },
      };
    },
  };
  return api;
}
