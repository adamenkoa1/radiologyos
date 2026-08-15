# RadiologyOS Domain Model

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

## Payment

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

`Payment` залишається сумісною медичною/read-model сутністю на перехідному етапі. Господарським джерелом істини цільової моделі є бізнес-документ `payment` та його рухи в `cash` і `patient_settlements`.

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

`documentId/documentLineId = null` допустимі лише для історичних legacy-рухів, створених до введення документного ядра. Новий linked movement має фізично посилатися на проведений документ того самого tenant і на точний рядок документа. Унікальність `(organizationId, documentLineId)` робить повторне проведення ідемпотентним на рівні руху.

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

Усі господарські події клініки у BAS-подібному ядрі мають спільний документний lifecycle.

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

`inventory_receipt` і `inventory_writeoff` вже використовують `business_documents` як registrar:

- `draft` не змінює залишок;
- `posted` створює `inventory_movements`;
- повторне `post` не дублює рух;
- недостатній залишок блокує списання до створення нового руху;
- cross-tenant document/item/lot/booking references відхиляються;
- compatibility API `receive/writeoff` теж проходить через створення + проведення документа.

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

На першому практичному етапі складські шаблони є code-defined (`templateVersion = 1`). Окремий persistent каталог `PrintedFormDefinition` буде потрібен, коли шаблони стануть конфігурованими tenant-ами; це не блокує immutable snapshots уже сформованих форм.

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

Конкретна D1-реалізація зберігає canonical render payload, версію шаблону, стан документа та SHA-256. Snapshot є append-only: UPDATE/DELETE заборонені trigger-ами. Для non-draft складського документа перша сформована форма конкретного `documentState + templateVersion` стає канонічною для повторного друку; подальше перейменування номенклатури чи інша зміна master data не переписує історичну форму.

`storageKey` зарезервований для persisted binary PDF/object storage. Поточна v1 форма вже має A4 print layout і підтримує browser print / Save as PDF; канонічні дані та hash зберігаються в D1.

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