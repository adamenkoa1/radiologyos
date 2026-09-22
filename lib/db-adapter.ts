// PoC (спайк) переходу з Cloudflare D1 (SQLite) на PostgreSQL.
//
// Ідея: тонкий спільний інтерфейс доступу до БД, який реалізують і D1, і Postgres.
// Це дозволяє мігрувати поступово — переносити 685 наявних викликів .prepare()
// на цей інтерфейс модуль за модулем, а не переписувати все одразу.
//
// ВАЖЛИВО: це ізольований спайк. Він НЕ підключений до жодного наявного запиту
// й не змінює рантайм. Мета — оцінити реальність і зафіксувати розбіжності
// діалектів (див. docs/postgres-poc.md).

export type SqlParam = string | number | boolean | null;

export interface SqlRunResult {
  /** last_row_id (D1) або id з RETURNING (Postgres); 0, якщо незастосовно. */
  lastRowId: number;
  /** Кількість змінених рядків. */
  changes: number;
}

/** Спільний контракт доступу до БД. Запити пишуться з плейсхолдерами «?». */
export interface SqlDatabase {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<SqlRunResult>;
}

// ───────────────────────── D1 / SQLite адаптер ─────────────────────────
// Плейсхолдери «?» — рідні для D1, тож наявні запити переносяться дослівно.

interface D1PreparedLike {
  bind(...args: SqlParam[]): {
    all<T>(): Promise<{ results?: T[] }>;
    first<T>(): Promise<T | null>;
    run(): Promise<{ meta?: { last_row_id?: number; changes?: number } }>;
  };
}
interface D1Like { prepare(sql: string): D1PreparedLike }

export function d1Adapter(db: D1Like): SqlDatabase {
  return {
    async all<T>(sql: string, params: SqlParam[] = []) {
      const r = await db.prepare(sql).bind(...params).all<T>();
      return r.results ?? [];
    },
    async first<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).bind(...params).first<T>();
    },
    async run(sql: string, params: SqlParam[] = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return { lastRowId: Number(r.meta?.last_row_id ?? 0), changes: Number(r.meta?.changes ?? 0) };
    },
  };
}

// ───────────────────────── PostgreSQL адаптер ─────────────────────────
// Приймає будь-який клієнт із методом query() — node-postgres (pg),
// postgres.js або Cloudflare Hyperdrive, — тож PoC не додає рантайм-залежності
// від конкретного драйвера.

export interface PgClientLike {
  query(sql: string, params: SqlParam[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
}

/**
 * Плейсхолдери «?» → «$1..$n». УВАГА: наївна заміна не враховує «?» усередині
 * рядкових літералів — робочий транслятор має пропускати літерали (див. doc).
 */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function pgAdapter(client: PgClientLike): SqlDatabase {
  return {
    async all<T>(sql: string, params: SqlParam[] = []) {
      const r = await client.query(toPgPlaceholders(sql), params);
      return r.rows as T[];
    },
    async first<T>(sql: string, params: SqlParam[] = []) {
      const r = await client.query(toPgPlaceholders(sql), params);
      return (r.rows[0] as T) ?? null;
    },
    async run(sql: string, params: SqlParam[] = []) {
      // У Postgres немає last_row_id: для INSERT без RETURNING додаємо RETURNING id.
      const needsReturning = /^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql);
      const r = await client.query(toPgPlaceholders(needsReturning ? `${sql} RETURNING id` : sql), params);
      const idValue = r.rows[0]?.id;
      return { lastRowId: typeof idValue === "number" ? idValue : 0, changes: r.rowCount ?? r.rows.length };
    },
  };
}
