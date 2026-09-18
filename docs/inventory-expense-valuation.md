# Inventory expense valuation

RadiologyOS values inventory writeoffs by the acquisition cost of the exact lot that is consumed. It does not use a manually entered expense amount and does not invent cost for historical stock.

## Valuation source

Every receipt line posted through the inventory document workflow creates its own `inventory_lot`. If that receipt line has supplier valuation, its immutable `unit_cost` and `line_amount` are the acquisition-cost evidence for the lot.

A writeoff still records only the physical quantity in `inventory_movements`. After the posted writeoff movement is inserted, D1 resolves the one posted receipt line that created the lot and automatically appends an `expense_movements` row containing:

- exact writeoff movement/document/line;
- exact source receipt document/line;
- item, lot, warehouse and optional booking dimensions;
- source `unit_cost` snapshot;
- recognized expense amount;
- reason, actor and business-document occurrence date.

The expense row is append-only and cannot be updated or deleted.

## Rounding

Money is currently represented in whole UAH. Partial writeoffs use `round(quantity × source unit cost)` but never exceed the lot's remaining unrecognized acquisition value. When the lot's final quantity is consumed, the final expense receives the exact remaining value. Therefore the sum of expenses for a fully consumed valued lot equals the original receipt `line_amount` even when fractional quantities are written off in several steps.

## Compatibility and fail-closed behavior

- A zero-cost receipt creates no synthetic expense.
- A legacy lot with no posted receipt-document valuation creates no synthetic expense.
- More than one posted receipt origin for the same lot is treated as ambiguous and the valued writeoff fails closed.
- A forged source receipt, lot, item, warehouse, booking, amount or actor is rejected by D1 integrity guards.
- No historical expense backfill is performed.

`expenses` is exposed in the register turnover report and grouped by inventory item. `inventory_reservations` remains intentionally unimplemented until RadiologyOS has an actual service-to-material requirement/reservation model; a placeholder register must not create fictional stock commitments.
