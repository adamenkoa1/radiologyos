# RadiologyOS Domain Model

## Architectural layers

```text
BAS Small Company = business_core
RadiologyOS = business_core + medical
Public site = public_site adapter / storefront / intake
```

`public_site` не володіє проведеними господарськими фактами. `medical` залежить від business-core там, де клінічна подія породжує господарський факт, але DICOM/PACS, протоколи й результати залишаються окремими medical-domain сутностями.

## Patient

```ts
Patient {
  id
  fullName
  birthDate
  phone
  email?
  category: military | civilian
  department?
  notes?
  createdAt
  updatedAt
}
```

Телефон є каналом зв'язку, але не достатнім ідентифікатором пацієнта: один номер може використовуватися кількома членами сім'ї. Після OTP-перевірки patient session зберігає tenant, телефон і доведену identity scope: або `dob + дата народження`, або `booking + точний код заявки`. Усі cabinet/result/self-service запити зобов'язані застосовувати цю scope разом із tenant і телефоном.

```ts
PatientSession {
  organizationId
  phoneNormalized
  identityKind: dob | booking
  identityValue
  expiresAt
}
```

OTP challenge, patient session і Telegram deep-link не можуть мати вигадану scope: D1 перевіряє, що в tenant існує заявка з тим самим телефоном і відповідною датою народження або кодом заявки. Telegram chat також зберігається для конкретної patient identity, а не на рівні всього номера телефону.

## Application

Одна заявка належить одному пацієнту.

```ts
Application {
  id
  patientId
  source?
  desiredDate?
  desiredTime?
  status
  comment?
  studies[]
  createdAt
  updatedAt
}
```

## StudyRequest

```ts
StudyRequest {
  id
  applicationId
  serviceId
  modality
  bodyPart
  contrast
  priority: routine | urgent
  status
}
```

## Appointment

```ts
Appointment {
  id
  studyRequestId
  roomId
  equipmentId
  startAt
  endAt
  doctorId?
  radiographerId?
  status
}
```

## Service

```ts
Service {
  id
  code
  group
  title
  description
  modality
  durationMinutes
  price
  nkCode?
  active
}
```

## Room

```ts
Room {
  id
  name
  floor
  type
  active
}
```

## Equipment

```ts
Equipment {
  id
  roomId
  name
  type
  manufacturer?
  model?
  status
  slotStepMinutes
}
```

## Employee

```ts
Employee {
  id
  fullName
  roleId
  rank?
  phone?
  email?
  active
}
```

## Role

```ts
Role {
  id
  code
  name
  permissions[]
}
```

## Protocol

```ts
Protocol {
  id
  organizationId
  studyRequestId
  doctorId
  templateId?
  description
  conclusion
  status: draft | signed
  signedAt?
  version
}
```

Протокол та кожна його ревізія належать тому самому tenant, що й дослідження/заявка. Цей інваріант має перевірятися не лише API-фільтрами, а й на рівні D1. Історичні ревізії також зберігають `organizationId`, щоб читання історії не залежало від неявного tenant-контексту.

`protocol_revisions` є append-only журналом клінічних знімків: існуючу версію не можна змінити або видалити на рівні D1; виправлення створює нову версію. Читання конкретної старої версії — окрема read-only операція з tenant/RBAC/assignment перевіркою та security audit, який містить лише номер версії, а не клінічний текст.

Клінічний документ `protocols` є джерелом істини для стану протоколу. Поля `bookings.protocol_status`, `bookings.protocol_number`, `protocol_ready_at` та `protocol_issued_at` — сумісна read-model для черг, звітів і кабінету пацієнта; D1 автоматично проєктує їх із документа та відхиляє прямі записи, що не відповідають поточному протоколу. Заявка без рядка `protocols` не може рекламувати готовий або виданий результат.

## ImagingStudy / DICOM

```ts
ImagingStudy {
  organizationId
  bookingId
  accessionNumber
  studyInstanceUid
  modality
  seriesCount
  instancesCount
  studyStatus
  studyDatetime
  source
  updatedBy
  updatedAt
}
```

Зв'язок із PACS належить тому самому tenant, що й заявка: `(bookingId, organizationId)` перевіряється на рівні D1. Непорожній `StudyInstanceUID` може бути прив'язаний лише до однієї заявки в межах однієї організації; різні організації не пов'язуються цим обмеженням між собою. Налаштування PACS також tenant-scoped і не можуть посилатися на неіснуючу організацію.

`ImagingStudy` — виключно DICOM/PACS-сутність. Господарський документ, який фіксує факт виконання дослідження для облікових рухів, має окремий тип `study_performance`.

## Payment compatibility model

```ts
Payment {
  id
  applicationId
  amountExpected
  amountPaid
  method?
  status
  paidAt?
}
```

Поля оплати в booking та `payment_transactions` залишаються compatibility/technical read-model. Після BAS-переходу проведеним господарським джерелом істини є `BusinessDocument(type=payment|refund)` і його рухи.

`payment_transactions` — технічний gateway ledger:

```ts
PaymentTransaction {
  id
  organizationId
  bookingId
  amount
  currency
  provider
  providerReference
  status: pending | paid | failed | refunded | cancelled
  paymentDocumentId?
  refundDocumentId?
  paidAt?
  refundedAt?
}
```

`pending` може бути створений зовнішнім сайтом/платіжним сценарієм і не є господарським фактом. Після trusted confirmation встановлюється `paymentDocumentId`; після проведеного повернення — `refundDocumentId`. Встановлені document links є незмінними. Старі paid/refunded транзакції без links залишаються explicit legacy і не backfill-яться евристично.

У поточній full-payment моделі D1 допускає лише одну linked `paid` transaction для одного booking одночасно. Після refund transaction виходить із цього partial uniqueness scope, тому майбутня нова оплата може бути проведена окремим документом.

## FinanceDocumentDetail

Таблично-реквізитна частина `payment/refund` registrar:

```ts
FinanceDocumentDetail {
  organizationId
  documentId
  bookingId
  patientId
  amount
  currency
  method
  provider
  providerReference
  sourceDocumentId?
  sourceTransactionId?
  createdAt
}
```

Для `refund` `sourceDocumentId` посилається на первинний проведений payment document, якщо він існує, а `sourceTransactionId` обов'язково claim-ить точну технічну платіжну транзакцію. Один source transaction може бути підставою не більше ніж для одного refund document; це фізично закриває конкурентне подвійне повернення. D1 перевіряє tenant booking/patient/source document/source transaction і дозволяє редагування реквізитів лише доки document у `draft`.

## CashMovement

```ts
CashMovement {
  id
  organizationId
  documentId
  bookingId
  movementType: payment | refund
  amountDelta
  currency
  method
  provider
  providerReference
  actorEmail
  occurredAt
}
```

Знак: `payment = +amount`, `refund = -amount`. Регістр append-only. D1 звіряє exact posted registrar, booking, currency, payment metadata та знак/суму.

## PatientSettlementMovement

```ts
PatientSettlementMovement {
  id
  organizationId
  documentId
  bookingId
  patientId
  movementType: charge | payment | refund | adjustment
  amountDelta
  currency
  actorEmail
  occurredAt
}
```

Конвенція сальдо: позитивне — пацієнт винен організації, від'ємне — кредит пацієнта. Тому `payment = -amount`, `refund = +amount`; майбутній `service_delivery` створює `charge = +amount`. Регістр append-only.

## ContrastChecklist

```ts
ContrastChecklist {
  id
  studyRequestId
  creatinine?
  creatinineDate?
  creatinineVerified
  catheterGauge?: 18 | 20
  iodineAllergy
  kidneyDisease
  metformin
  thyroidDisease
  asthma
  pregnancyOrBreastfeeding
  emergencyOverride
  approvedByDoctorId?
}
```

## InventoryItem

```ts
InventoryItem {
  id
  name
  unit
  quantity
  minimumQuantity
  category
}
```

Поле `quantity` є сумісною read-model на перехідному етапі. Фактичний залишок складу вже обчислюється з immutable `inventory_movements`; нові рухи після BAS-переходу мають документ-реєстратор. Старі рухи без документа не backfill-яться за телефоном, датою, партією чи іншою евристикою і залишаються explicit legacy records.

## InventoryDocumentLine

Перша практична таблична частина BAS-подібного `BusinessDocument`.

```ts
InventoryDocumentLine {
  id
  organizationId
  documentId
  lineNo
  itemId
  lotId?
  lotNumber
  expiresOn
  supplier
  quantity
  reason
  bookingId?
}
```

Для `inventory_receipt` рядок створюється з номенклатурою та реквізитами майбутньої партії; партія і складський рух з'являються під час проведення. Для `inventory_writeoff` рядок посилається на конкретну існуючу tenant-scoped партію. D1 дозволяє INSERT/UPDATE/DELETE рядків лише поки документ у `draft`.

## InventoryMovement

```ts
InventoryMovement {
  id
  organizationId
  itemId
  lotId
  movementType: receipt | writeoff
  quantityDelta
  reason
  bookingId?
  actorEmail
  documentId?
  documentLineId?
  createdAt
}
```

`documentId/documentLineId = null` допустимі лише для історичних legacy-рухів, створених до введення документного ядра. Новий linked movement має фізично посилатися на проведений документ того самого tenant і на точний рядок документа. Унікальність `(organizationId, documentLineId)` робить повторне проведення ідемпотентним на рівні руху. Сам ledger append-only; D1 також фізично не дозволяє списання, яке зробить залишок партії від'ємним.

## EquipmentEvent

```ts
EquipmentEvent {
  id
  equipmentId
  type: failure | maintenance | calibration | downtime
  startedAt
  endedAt?
  description
  responsibleId?
}
```

## BusinessDocument

Усі господарські події клініки у BAS-подібному ядрі мають спільний document lifecycle.

```ts
BusinessDocument {
  id
  organizationId
  type: patient_order | appointment | service_delivery | payment | refund |
        inventory_receipt | inventory_writeoff | inventory_transfer |
        inventory_count | study_performance | result_delivery
  number
  occurredAt
  state: draft | posted | reversed | cancelled
  comment
  createdBy
  createdAt
  postedBy?
  postedAt?
  reversedDocumentId?
}
```

Після `posted` господарські факти документа не редагуються тихо. Виправлення робиться через коригування/сторно з явним посиланням на першоджерело. Проведення документа створює tenant-scoped рухи в регістрах. D1 забороняє UPDATE/DELETE проведених фактів; єдиний дозволений post-state transition у базовому lifecycle — `posted → reversed` без зміни первинних реквізитів.

### Реалізовано для складу

`inventory_receipt` і `inventory_writeoff` використовують `business_documents` як registrar:

- `draft` не змінює залишок;
- `posted` створює `inventory_movements`;
- повторне `post` не дублює рух;
- недостатній залишок блокує списання;
- cross-tenant references відхиляються;
- compatibility API `receive/writeoff` теж проходить через документ.

### Реалізовано для фінансів

`payment` і `refund` використовують той самий registrar:

- trusted confirmed payment створює `payment` document і рухи `cash + patient_settlements`;
- refund є окремим документом, а не UPDATE первинної оплати;
- повторне підтвердження/повернення ідемпотентне;
- `payment_transactions` зв'язується з точними document ids;
- одна linked full payment на booking захищена partial unique index;
- refund claim-ить точний `sourceTransactionId`, тому одна transaction не може створити два повернення;
- публічний pending payment не створює registrar/register movement;
- legacy transactions лишаються без штучного документа.

Грошовий `refund` не є автоматичним reversal `revenue`: дохід коригується тільки через корекцію/сторно факту наданої послуги.

## RegisterMovement

```ts
RegisterMovement {
  id
  organizationId
  register
  documentId
  occurredAt
  dimensions
  resources
}
```

Канонічні регістри:

- `patient_settlements`;
- `cash`;
- `revenue`;
- `expenses`;
- `inventory_balance`;
- `inventory_reservations`;
- `services_delivered`;
- `equipment_load`;
- `staff_output`;
- `studies_performed`;
- `receivables`.

Рух без документа-реєстратора не допускається для нових бізнес-операцій. Історичні записи, що реально існували до введення registrar-моделі, не отримують вигаданий документ шляхом backfill.

## PrintedFormDefinition

```ts
PrintedFormDefinition {
  id
  organizationId
  formType
  documentType
  templateVersion
  title
  active
}
```

Типові форми: рахунок, квитанція, акт наданих послуг, направлення, протокол, результат, складські форми та службові форми.

Перші практичні шаблони є code-defined (`templateVersion = 1`). Окремий persistent каталог `PrintedFormDefinition` буде потрібен, коли шаблони стануть конфігурованими tenant-ами; це не блокує immutable snapshots уже сформованих форм.

## PrintedFormSnapshot

```ts
PrintedFormSnapshot {
  id
  organizationId
  documentId
  formType
  templateVersion
  documentState
  payloadJson
  generatedAt
  generatedBy
  storageKey
  sha256
}
```

D1-реалізація зберігає canonical render payload, версію шаблону, стан документа та SHA-256. Snapshot є append-only: UPDATE/DELETE заборонені trigger-ами. Для non-draft документа перша сформована форма конкретного `documentState + templateVersion` стає канонічною для повторного друку; подальша зміна master data не переписує історичну форму.

Для складу formType відповідає inventory document type. Для payment/refund використовується `payment_receipt`; payload snapshot-ить номер документа, booking, ПІБ, послугу, суму, метод, provider/reference та source document для повернення.

`storageKey` зарезервований для persisted binary PDF/object storage. Поточні v1 форми мають A4 print layout і підтримують browser print / Save as PDF; канонічні дані та hash зберігаються в D1.

## AuditEvent

```ts
AuditEvent {
  id
  userId
  action
  entityType
  entityId
  createdAt
  metadata
}
```