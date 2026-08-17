# Study-performance registrar

RadiologyOS now has a physical BAS-like `study_performance` business document for newly posted performed studies.

## Staged ownership model

This block separates documentary identity from register ownership without rewriting existing accounting history.

- `service_delivery` remains the current owner of `services_delivered`, equipment-load, staff-output, revenue and patient-settlement movements.
- Every new `service_delivery` transition from `draft` to `posted` creates one immutable posted `study_performance` document in the same D1 transaction.
- `study_performance.basis_document_id` points to the exact source `service_delivery` document.
- The performance document's number, occurred-at timestamp and actor are derived from the posted source and its immutable `service_delivery_details` snapshot.
- The performance document itself creates no register movements in this stage, so it cannot double-count a study, equipment time, staff output or revenue.

## Numbering and lineage

The deterministic number is:

`ВД-{service_delivery_id padded to 6 digits}`

For example, service-delivery document `123` produces `ВД-000123`.

The existing business-document journal exposes the relationship through the generic `basis_document_id` / `based_on` lineage.

## Storno

A `study_performance` document cannot be reversed independently while its source `service_delivery` remains posted. When a real service storno reverses the source document, D1 reverses the linked performance document in the same transaction path.

The negative operational/economic movements still belong only to the existing service-correction registrar in this staged block.

## Historical data

Historical posted service-delivery documents are deliberately not backfilled. A historical completed booking receives a performance document only if its service delivery is explicitly posted after this migration. This avoids inventing retrospective documentary facts.

## Security and integrity

D1 enforces:

- same-tenant basis lineage;
- a posted `service_delivery` basis;
- an existing immutable service-delivery snapshot;
- deterministic number/time/actor identity;
- one performance document per source;
- source-first storno ordering.

No patient-facing API or medical protocol content is added by this registrar.

## Next architectural step

After the physical registrar is established, operational movement ownership can be moved from `service_delivery` to `study_performance` in a separate migration with explicit correction semantics. The existing `studies_performed` read model must remain continuous during that transition and no movement may be counted twice.
