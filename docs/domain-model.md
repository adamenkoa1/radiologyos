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
