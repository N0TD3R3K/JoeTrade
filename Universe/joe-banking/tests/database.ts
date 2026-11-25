import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { Env } from "../src/env";

type Value = string | number | bigint | Uint8Array | null;
class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: Value[] = [],
  ) {}
  bind(...values: Value[]) {
    return new Statement(this.db, this.sql, values);
  }
  async first<T>(): Promise<T | null> {
    return (
      (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    );
  }
  async all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.values) as T[],
      success: true,
    };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

export class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    const migrations = new URL("../database/migrations/", import.meta.url);
    for (const file of readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      this.db.exec(readFileSync(new URL(file, migrations), "utf8"));
    this.db.exec(
      readFileSync(
        new URL("../database/seed/local-demo.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  env(): Env {
    return {
      DB: this as unknown as D1Database,
      ASSETS: {
        fetch: async () => new Response("assets"),
      } as unknown as Fetcher,
      ENVIRONMENT: "local",
      ALLOW_LOCAL_DEMO: "true",
      APP_ORIGIN: "http://127.0.0.1:4180",
      JOEAUTH_ISSUER: "https://auth.example.test",
    };
  }
}
