# Study-performance operational ownership

## Boundary

`service_delivery` is the economic registrar for the delivered service. It owns the immutable service snapshot plus revenue and patient-settlement movements.

`study_performance` is the operational registrar for the performed study. For new postings it owns:

- `services_delivered_movements` (the canonical performed-study/service count fact),
- `equipment_load_movements` positive load,
- `staff_output_movements` positive output.

The two documents are linked by `study_performance.basis_document_id = service_delivery.id`. A booking completion or explicit legacy posting first posts `service_delivery`; D1 then creates the linked posted `study_performance`, whose insert trigger appends the positive operational movements.

## Storno

Storno remains a separate `service_delivery` correction document so the existing economic correction chain stays intact. Reversing a source `service_delivery` first reverses its linked `study_performance`, then posts the correction and appends:

- `service_correction_movements` for the performed-study count,
- negative `equipment_load_movements`,
- negative `staff_output_movements`,
- negative revenue/patient-settlement movements when the source carried a charge.

For sources that have a linked `study_performance`, correction guards require that exact registrar to be reversed before negative operational movements are accepted. Historical service deliveries that predate the performance registrar remain reversible when no linked performance document exists.

## History and reporting

Migration 0091 does not rewrite or backfill historical movement rows. Older rows can therefore retain a `service_delivery` document ID while new positive operational rows reference `study_performance`. The register totals remain append-only and the `studies_performed` read model continues to calculate the net union of positive `services_delivered_movements` and explicit `service_correction_movements`.

This preserves historical evidence while moving all new operational ownership to the canonical registrar.

## Invariants

- one `study_performance` per source `service_delivery`;
- positive operational movements cannot be inserted under a new economic source document;
- performance/source/snapshot/tenant identities must match exactly;
- revenue and patient settlements never move to `study_performance`;
- a linked performance registrar must be reversed before operational storno can post;
- existing movement rows remain immutable;
- automatic and explicit posting use the same ownership model;
- no production backfill is performed.
