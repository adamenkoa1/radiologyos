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
