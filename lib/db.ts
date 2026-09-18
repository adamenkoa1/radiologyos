// Доступ до site-owned D1-біндингу з серверних маршрутів. Worker кладе
// env.DB у globalThis (див. worker/index.ts), щоб не тягнути runtime-only
// модуль `cloudflare:workers` у збірку. Єдине джерело замість копії у
// кожному route-файлі.
export function dbBinding(): D1Database | undefined {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}
