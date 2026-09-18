# Study-performance operational ownership

## Boundary

`service_delivery` is the economic registrar for the delivered service. It owns the immutable service snapshot plus revenue and patient-settlement movements.

`study_performance` is the operational registrar for the performed study. For new postings it owns:

- `services_delivered_movements` (the canonical performed-study/service count fact),
- `equipment_load_movements` positive load,
- `staff_output_movements` positive output.

The two documents are linked by `study_performance.basis_document_id = service_delivery.id`. A booking completion or explicit legacy posting first posts `service_delivery`; D1 then creates the linked posted `study_performance`, whose insert trigger appends the positive operational movements.

## Storno

The correction chain is deliberately split along the same economic/operational boundary.

`service_correction` remains the economic correction document. It reverses revenue and patient settlements and preserves the existing service-delivery correction snapshot.

For a source that has `study_performance`, migration 0093 also creates exactly one posted `study_correction` after the performance registrar is reversed. The new document uses:

- `basis_document_id = study_performance.id`;
- `reversed_document_id = study_performance.id`;
- deterministic number `КВ-<service correction id padded to 6 digits>`;
- the same actor, occurrence time and posting time as the economic correction.

`study_correction` owns the negative operational rows:

- `service_correction_movements` for performed-study count/regions;
- negative `equipment_load_movements`;
- negative `staff_output_movements`.

Revenue and patient-settlement reversals never move to `study_correction`.

Historical service deliveries that predate `study_performance` remain reversible through the original correction registrar. No historical performance or correction document is invented.

## History and reporting

Migrations 0091 and 0093 do not rewrite or backfill historical movement rows. Older positive/negative rows can therefore retain a `service_delivery` correction owner, while new positives reference `study_performance` and new operational negatives reference `study_correction`.

The canonical `studies_performed` read model intentionally calculates the net append-only union of positive `services_delivered_movements` and explicit `service_correction_movements`, independent of which historical registrar ID owns a row.

This preserves historical evidence while making new operational ownership symmetric.

## Invariants

- one `study_performance` per source `service_delivery`;
- one `study_correction` per reversed `study_performance`;
- positive operational movements cannot be inserted under a new economic source document;
- new negative operational movements cannot be inserted under the economic correction when a performance registrar exists;
- performance/source/correction/tenant identities must match exactly;
- revenue and patient settlements never move to `study_performance` or `study_correction`;
- a linked performance registrar must be reversed before operational storno can post;
- existing movement rows remain immutable;
- automatic and explicit posting use the same ownership model;
- no production backfill is performed.
