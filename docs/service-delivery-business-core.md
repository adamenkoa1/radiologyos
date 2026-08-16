# Service delivery in the RadiologyOS business core

## Boundary

The canonical product boundary remains:

```text
BAS Small Company = business core
RadiologyOS = business core + medical modules
Public site = storefront / booking intake
```

A performed radiology study is first a **medical execution fact**. It becomes a business fact only through the `service_delivery` registrar.

```text
medical: bookings.performed_at + booking_events.execution_recorded
        ↓
business: service_delivery Act (posted)
        ↓
registers: revenue / patient_settlements / equipment_load / staff_output
        ↓
report / printed service_act snapshot
```

DICOM/PACS identifiers, protocol lifecycle and result delivery do not post revenue and are not reused as business documents.

## Canonical trigger

`status='completed'` alone is not enough to recognize a delivered service. Legacy UI still allows broad status transitions for compatibility, therefore economic posting is anchored to the existing explicit execution operation:

- `bookings.performed_at` is non-empty;
- an `execution_recorded` booking event is written for the same organization and booking.

The D1 posting trigger then creates one posted `service_delivery` document for that booking. A repeated execution event is idempotent and does not create a second Act.

Historical rows with `performed_at` but no Act are not guessed or backfilled. The service-delivery journal exposes their count as `unpostedPerformedCount` so they can be reviewed explicitly.

## Posting semantics

### Civilian service

A posted Act creates:

- `revenue_movements`: positive recognized service revenue;
- `patient_settlement_movements`: positive `charge` (the patient owes the organization);
- `equipment_workload_movements`: one performed study plus duration and anatomical-region count;
- `staff_output_movements`: one row for each assigned radiologist/radiographer present in the execution snapshot.

If the patient paid before the study, payment previously created a negative patient-settlement movement. The Act's positive charge then offsets that advance. Payment and service delivery remain separate facts.

### Military service

The Act is still created because the study was delivered, but `charge_amount=0`:

- no commercial revenue movement;
- no patient charge;
- equipment workload and staff output are still recorded.

This preserves operational statistics without inventing a patient receivable.

## Immutability and correction

After the Act is posted, ordinary booking edits cannot silently change the economic execution snapshot:

- `performed_at`;
- service code/name;
- amount used for the charge;
- patient category;
- equipment;
- duration;
- anatomical region count;
- assigned radiologist/radiographer.

Medical/reference metadata that is not part of the business posting, such as `external_reference`, remains independently editable.

A future correction must be an explicit correction/storno document. A money refund does not automatically reverse recognized revenue, because returning money is not the same event as cancelling a performed service.

## Printed Act

`service_act` is a first-class versioned printed form. The first render stores an append-only `printed_form_snapshots` payload with:

- tenant + exact service-delivery document;
- document state;
- template version;
- generated-by/time;
- SHA-256;
- the historical Act payload required for reprint.

Reprinting a posted Act returns the original snapshot even if non-economic master/display data changes later. D1 rejects a `service_act` snapshot linked to a non-service document.

## Security

- all documents and registers are `organization_id` scoped;
- the service journal and Act print endpoints require the finance-management capability (`admin` or `registrar`);
- clinicians do not receive the finance/business journal through these endpoints;
- forged register movements must match the exact posted registrar snapshot or D1 aborts;
- business register rows and printed snapshots are append-only;
- the public site cannot create a service-delivery Act or post any of these registers.
