# BAS service-delivery storno

A posted `service_delivery` is never edited or deleted. A correction is prepared as a separate business document linked to the source and the source is then moved `posted -> reversed`.

## Posting boundary

The source state transition is the D1 posting boundary. D1 requires an exact draft correction, posts that correction, and writes all negative movements in the same SQLite transaction. If any register insert fails, source reversal and correction posting fail together.

The correction reverses:

- rendered-service count through `service_correction_movements`;
- revenue through a negative `revenue_movements` entry;
- patient accrual through a negative `adjustment` in `patient_settlement_movements`;
- equipment load through negative minutes;
- radiologist/radiographer output through negative units.

Military/free services reverse operational output without inventing revenue or patient debt.

## Cash boundary

Service storno is not a refund. If a service was already paid, storno removes the charge/revenue and leaves the cash movement untouched. The patient balance therefore becomes a credit until a separate `refund` document returns money.

## Invariants

- source cannot enter `reversed` without an exact draft correction;
- correction cannot be manually posted while source is still posted;
- after correction details are captured, correction identity is frozen;
- negative register movements require the exact reversed source and posted correction;
- reversed service facts remain immutable and cannot be posted again;
- an interrupted exact draft correction can be safely resumed by a later request;
- tenant and finance-role scope apply to correction API/journal access.
