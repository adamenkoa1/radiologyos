# Changelog

Формат: Keep a Changelog.

## [Unreleased]

### Changed
- Канонічну межу продукту зафіксовано явно: `BAS Small Company = бізнесове ядро`, `RadiologyOS = BAS-подібне ядро + медичні модулі`, `Публічний сайт = зовнішня вітрина і канал запису`; public layer не є власником проведених господарських фактів.
- Платежі переведено на BAS registrar: trusted підтверджена оплата створює і проводить `business_documents(type=payment)`, після чого атомарно створюються `cash_movements(+amount)` і `patient_settlement_movements(-amount)`; публічний `pending payment_transaction` не створює бізнес-документів або регістрових рухів.
- Повернення стало окремим `business_documents(type=refund)` із посиланням на первинний payment document, рухами `cash(-amount)` і `patient_settlements(+amount)` та ідемпотентним повторним викликом. Грошовий refund більше не моделюється як автоматичне сторно `revenue` — дохід коригується тільки через корекцію/сторно факту наданої послуги.
- `payment_transactions` збережено як технічний payment-provider/manual ledger і доповнено незмінними `payment_document_id` / `refund_document_id`; історичні paid/refunded транзакції без registrar links залишаються explicit `Legacy` без евристичного backfill.
- Додано D1-hardening фінансового registrar: tenant/booking/patient/source-document integrity, append-only cash/settlement registers, exact sign/amount/currency/provider/reference contract і заборона обнулення або підміни вже встановленого document link.
- Додано `/staff/finance` з BAS-подібними вкладками `Документи / Рухи грошей / Взаєморозрахунки`, register-derived підсумками та окремим Legacy count; фінанси винесено в business-core навігацію й command palette.
- Додано `/staff/finance/print` і `payment_receipt` template v1: tenant/RBAC guarded immutable snapshot, SHA-256, A4 browser print/Save as PDF та повторний друк історичного payload навіть після зміни ПІБ/назви послуги.
- Додано behavioral/security coverage для payment/refund posting, idempotency, public pending boundary, tenant isolation, immutable registrar links, forged movement rejection та immutable finance print snapshots.
- Склад став першим повністю практичним BAS-подібним модулем: `Номенклатура → Складський документ → Проведення → Регістр рухів → Друкована форма`.
- Додано загальний tenant-scoped реєстр `business_documents` і складські табличні частини `inventory_document_lines`; нові надходження та списання створюють документ-реєстратор, а старі рухи залишаються `Legacy` без небезпечного backfill за здогадками.
- Чернетка складського документа не змінює залишок; `posted` створює рухи один раз, повторне проведення ідемпотентне, а проведені господарські факти фізично захищені D1 від тихого UPDATE/DELETE.
- Старі API-дії `receive/writeoff` збережено як compatibility wrapper, але вони тепер також створюють і проводять бізнес-документ, тому нові рухи більше не обходять BAS-ядро.
- `/staff/inventory` отримав окремі вкладки `Залишки / Документи / Рухи`, журнал складських документів, картку документа, стани `Чернетка / Проведено / Скасовано`, дії `Провести / Скасувати / Друк` і зв'язок руху з документом-реєстратором.
- Додано реальні версійні друковані форми складських документів: immutable `printed_form_snapshots`, template v1, SHA-256 і захищена A4-форма з браузерним друком/Save as PDF. Для проведеного документа повторний друк використовує перший канонічний snapshot цього стану і не підміняє історію поточними даними довідника.
- Додано behavioral coverage для draft/post/idempotency, недостатнього залишку без часткових рухів, tenant isolation, legacy ledger, D1-immutability та незмінного повторного друку після редагування номенклатури.
- Внутрішню архітектуру RadiologyOS переведено на BAS Small Company-подібний business-core принцип: `Довідники → Документи → Проведення → Регістри → Звіти`; правило стало обов'язковим для наступних змін через `AGENTS.md`.
- Додано канонічні типи довідників, бізнес-документів, станів проведення і регістрів у `lib/business-core.ts`; проведений документ не може бути тихо повернений у чернетку або скасований без сторно/коригування.
- Додано мапу документів на регістри для оплат, наданих послуг, складу, досліджень, навантаження обладнання та виробітку персоналу, плюс regression tests базових інваріантів.
- Друковані форми стали first-class частиною business core: тип форми прив'язаний до типу документа, шаблон версіонується, а сформована історична форма має snapshot із версією, автором, storage key та hash для відтворюваного повторного друку.
- У компонентній моделі визначено стандартні BAS-подібні форми `JournalForm`, `ReferenceForm`, `DocumentForm`, `SelectionForm`, `DocumentMovementsView`, `PrintMenu`, `PrintedFormPreview` і `RegisterReport` як основу внутрішнього `/staff` UI.
- `Payment.amountPaid` та `InventoryItem.quantity` позначено як перехідні read-model поля; цільові джерела істини — відповідні документи та рухи регістрів.
- Протоколи та їх ревізії тепер мають фізичний tenant-захист у D1: запис не може посилатися на заявку іншої організації; Drizzle schema синхронізовано з tenant-полями та індексами протоколів.
- Додано behavioral test, який виконує реальні cross-tenant INSERT/UPDATE протоколів і перевіряє їх відхилення базою даних.
- Клінічний документ `protocols` став джерелом істини для legacy-полів протоколу в `bookings`: D1 автоматично синхронізує статус, номер і часові мітки та відхиляє прямі записи, що розходяться з документом.
- Міграція прибирає хибний `ready/issued` у заявок без клінічного документа, залишаючи системний audit-event замість створення вигаданого протоколу; додано behavioral coverage життєвого циклу.
- DICOM/PACS-зв'язки отримали фізичний tenant-захист у D1: imaging study не може посилатися на заявку іншої організації, а один непорожній `StudyInstanceUID` не може бути прив'язаний до двох заявок одного tenant.
- Drizzle schema синхронізовано з tenant/UID-індексами `imaging_studies`; додано D1 behavioral tests і перевірку належності PACS settings існуючій організації.
- Автоматична DICOM-прив'язка за Accession тепер додатково вимагає валідний StudyInstanceUID, збіг модальності та дати дослідження; невідповідність fail-closed і не змінює imaging link.
- QIDO series parser відкидає некоректні `SeriesInstanceUID`; відмови auto-link аудіюються без UID/ПІБ/телефону та покриті behavioral tests.
- Patient OTP/session тепер несуть доведену identity scope (`dob` або точний `booking`), тому спільний сімейний номер телефону не розширює доступ до чужих заявок, протоколів, скасування чи оплати; D1 фізично перевіряє scope за реальною заявкою.
- Telegram deep-link і chat binding також стали identity-scoped. Небезпечні legacy phone-wide patient sessions, link tokens і Telegram chat bindings інвалідовуються під час міграції замість автоматичного перенесення між членами сім'ї.
- Додано behavioral regression coverage для двох пацієнтів з одним телефоном та різними датами народження.
- Історія `protocol_revisions` стала фізично append-only у D1: існуючу клінічну версію не можна UPDATE/DELETE; виправлення створює нову версію.
- Додано окремий read-only endpoint конкретної ревізії з tenant/RBAC/assignment перевіркою та security audit без клінічного тексту, плюс behavioral coverage незмінності та міжтенантної ізоляції.

### Planned
- Наступний business-core перенос: `service_delivery` / акт наданих послуг → `services_delivered + revenue + patient_settlements(+charge) + equipment_load + staff_output` із medical linkage без змішування DICOM/PACS і господарських документів.
- Підключення object storage для збереження бінарних PDF друкованих форм; D1 snapshot уже зберігає канонічні дані, версію та hash.
- Розділення `staff.html` на окремі модулі.
- Календар у стилі Google Calendar.
- Окремі ролі й права.
- Структурований об'єкт заявки з масивом досліджень.
- Підготовка до локального сервера.

## [0.22] — Web MVP

### Added
- Публічна головна сторінка.
- Сторінка «Про відділення».
- Сторінка для військовослужбовців.
- Прайс.
- Кошик послуг.
- Онлайн-заявка.
- Кабінет пацієнта у демонстраційному режимі.
- Панель персоналу.
- Черга на сьогодні.
- Тижневий календар.
- Редактор прайсу.
- Редактор персоналу.
- Редактор обладнання.
- Редактор контенту сайту.
- QR-код оплати.
- Google Apps Script інтеграція.
- Джерело рекламного трафіку.
- Локальне збереження через `localStorage`.

### Known limitations
- Авторизація на клієнті не є справжнім захистом.
- Дані між пристроями не синхронізуються без Apps Script.
- Файли направлення не мають захищеного серверного сховища.
- `localStorage` не підходить для реальних медичних даних.