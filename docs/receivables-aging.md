# Receivables aging

RadiologyOS does not create a second debt ledger. `patient_settlement_movements` remains the immutable accounting source of truth:

- service charge: positive patient balance;
- payment: negative movement;
- refund: positive movement;
- service storno: negative movement.

The canonical `receivables` register is a derived read model computed **as of a date** from those movements.

## Balance semantics

Balances are kept per booking and currency. A positive closing balance is receivable from the patient. A negative balance is patient credit / prepayment. Credits are reported separately and are not silently netted against debt from another booking.

For a positive balance, aging starts at the first positive movement after the most recent point where the running booking balance was zero or negative. This means a full payment closes the old aging chain; if a later refund reopens the balance, aging starts again from the refund.

Buckets are `0–30`, `31–60`, `61–90`, and `90+` days.

## Access and audit

The patient-level receivables report is admin-only through the existing `canViewReports` capability. Successful views write the standard `report_viewed` audit action with only `asOf`, row count and truncation status. Patient names, booking codes, IDs and monetary balances are not copied into `security_audit_log.details_json`.

The UI may show up to 2000 non-zero booking balances at once and explicitly marks truncation. The economic ledger itself is never truncated or rewritten.
