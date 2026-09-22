# PoC: перехід з Cloudflare D1 (SQLite) на PostgreSQL

Статус: **спайк / оцінка здійсненності.** Код PoC (`lib/db-adapter.ts`,
`tests/postgres-poc.test.mjs`) ізольований і не підключений до жодного наявного
запиту. За AGENTS.md PostgreSQL — **наступний етап** (поточний — Web MVP на D1).

## Що показує PoC

Спільний інтерфейс `SqlDatabase` (`all` / `first` / `run` з плейсхолдерами `?`),
який реалізують обидва рушії:

- `d1Adapter(db)` — обгортка над наявним D1 API (`prepare().bind().all/first/run`);
  запити переносяться дослівно. Перевірено на реальному SQLite через тест-харнес.
- `pgAdapter(client)` — той самий інтерфейс поверх будь-якого Postgres-клієнта
  (`pg`, `postgres.js`, Hyperdrive), тож PoC **не додає рантайм-залежності**.
  Транслює `?`→`$1..$n` і додає `RETURNING id` для `INSERT` (заміна `last_row_id`).

Висновок: **поступова міграція реальна** — 685 наявних викликів `.prepare()`
можна переносити на `SqlDatabase` модуль за модулем, а не переписувати все одразу.

## Масштаб зчеплення (заміри)

| Що | Обсяг |
|---|---|
| Прямі виклики D1 (`.prepare()`) | 685 у 119 файлах |
| Файли з `D1Database`/binding | 178 |
| Drizzle-схема | `dialect: "sqlite"`, увесь `db/schema.ts` на `sqliteTable` |
| Міграції | 121 SQL, з них 89 із SQLite-специфікою |

## Розбіжності діалектів, які треба закрити

| SQLite / D1 | PostgreSQL | Хто закриває |
|---|---|---|
| Плейсхолдери `?` | `$1..$n` | адаптер (є) |
| `meta.last_row_id` | `RETURNING id` | адаптер (є, для INSERT) |
| `INSERT OR IGNORE` | `INSERT … ON CONFLICT DO NOTHING` | переписати запити |
| `date('now','+30 day')`, `CURRENT_TIMESTAMP`, `strftime`, `substr(x,1,10)` | `CURRENT_DATE`, `now() + interval '30 days'`, `to_char`, `substring` | переписати запити |
| Булеві `0/1` (integer) | справжній `boolean` | схема + читання (`active`, `is_default`, `contrast_alert`…) |
| `AUTOINCREMENT` | `GENERATED ALWAYS AS IDENTITY` | схема/міграції |
| `LIKE` (нечутливий до регістру для ASCII) | `ILIKE` для нечутливого | переписати пошук |
| Тригери `CREATE TRIGGER … RAISE(ABORT,'msg')` | `CREATE FUNCTION … plpgsql (RAISE EXCEPTION)` + `CREATE TRIGGER … EXECUTE FUNCTION` | **найбільший обсяг** — immutability-тригери (cash_movements, patient_settlement_movements, printed_form_snapshots, personnel_card_snapshots тощо) |
| `PRAGMA` | не потрібне | видалити |

Обережно: наївна заміна `?`→`$n` не враховує `?` усередині рядкових літералів —
робочий транслятор має пропускати літерали (або перейти на іменовані параметри).

## Рантайм

Cloudflare Workers не відкриває сирий TCP до Postgres. Варіанти:
1. **Cloudflare Hyperdrive** + `postgres.js` — лишитись на Workers.
2. **Локальний Node-сервер** з Postgres — саме те, що AGENTS.md називає наступним
   етапом («Локальний сервер, PostgreSQL, Orthanc і DICOM»).

Тест-харнес `withD1` (better-sqlite3) потрібно продублювати Postgres-варіантом
із тим самим `SqlDatabase`-інтерфейсом (реальний ephemeral Postgres або pg-mem).

## Рекомендований порядок (інкрементально, без «великого вибуху»)

1. Прийняти `SqlDatabase`-адаптер (цей PoC).
2. Новий і змінюваний код доступу до БД писати через `SqlDatabase`, а не сирий D1 —
   щоб 685 більше не росло.
3. Схема: `sqliteTable`→`pgTable`; перегенерувати міграції в Postgres-діалекті;
   переписати тригери як plpgsql-функції.
4. Дати Postgres-харнес із тим самим інтерфейсом; ганяти тести на обох рушіях.
5. Мігрувати модуль за модулем (finance, inventory, patients…) за інтерфейсом.
6. Перемкнути рантайм (Hyperdrive або локальний Node), коли всі модулі на інтерфейсі.
7. Міграція даних: ETL D1 → Postgres зі збереженням immutable-регістрів.
