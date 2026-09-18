# Result-delivery registrar

## Boundary

The clinical protocol remains the source of truth for radiology content and versioning. `signed` means the exact clinical version is finalized by a radiologist. `issued` is an administrative delivery transition and does not create a new clinical revision.

For all new transitions after migration 0092, `signed -> issued` also creates exactly one posted `result_delivery` business document in the same D1 statement. If creation or validation of that document fails, protocol issuance rolls back.

Historical protocols that were already `issued` before 0092 are not backfilled. No retrospective delivery fact is invented.

## Delivery authority

Clinical authoring and administrative delivery are separate capabilities. `canManageProtocols()` controls clinical protocol access/editing, while `canDeliverResults()` allows `admin`, `registrar`, and `radiologist` to perform only the already-signed `signed -> issued` transition. A radiologist remains assignment-scoped; registrar/admin delivery is tenant-scoped.

The dedicated `/api/staff/result-deliveries` queue deliberately returns only delivery metadata: booking code, patient name, service title, document number/version, signer and signature time. It never returns protocol findings/conclusion/sections or addendum reason/correction text. Granting a registrar delivery authority therefore does not grant clinical read/edit/sign authority.

The delivery endpoint does not create business evidence itself. It changes canonical clinical state only; migrations 0092/0094 remain the sole D1 owners of the atomic immutable `result_delivery` snapshots, so a failed registrar creation rejects the issuance transition.

## Immutable snapshot

`result_delivery_details` stores the delivery evidence for the exact tenant and booking:

- booking and patient ID;
- service title;
- protocol number and version;
- original signer and signature timestamp;
- delivery actor and delivery timestamp.

The snapshot is populated by D1 from canonical booking/protocol state, not from client-supplied PHI. UPDATE and DELETE are rejected after creation.

## Lineage

When the booking has a same-tenant posted `study_performance`, the `result_delivery` document uses that document as `basis_document_id`. This produces the chain:

`service_delivery -> study_performance -> result_delivery`

Legacy bookings without a `study_performance` remain issuable; their delivery basis is `NULL` rather than an invented historical document.

## Registers and corrections

`result_delivery` owns no cash, settlement, revenue, inventory, performed-study, equipment-load, staff-output, or correction movements. It is documentary evidence only.

A delivered result is historical evidence and cannot use the generic posted-to-reversed transition. Any future correction/reissue model must be a separate explicit document lifecycle.

## D1 invariants

- new `issued` protocols must pass through the exact `signed -> issued` transition;
- a direct new `protocols(status='issued')` insert is rejected;
- one result-delivery snapshot exists per tenant/booking;
- document number is deterministic: `ВР-<booking id padded to 6 digits>`;
- document actor/timestamp and delivery snapshot must agree exactly;
- if a posted study-performance exists, it is the exact basis document;
- cross-tenant basis/snapshot links are rejected;
- delivery details are append-only/immutable;
- protocol issuance and registrar creation are atomic;
- migration 0092 performs no historical backfill.
