# Service material margin report

RadiologyOS exposes a read-only BAS-style contribution report for service revenue versus acquisition-cost material expense.

## Source of truth

The report never writes or reconstructs business facts. For the selected period it reads only posted append-only registers:

- `revenue_movements` for net service revenue, including service correction / storno rows;
- `expense_movements` for acquisition-cost material expense created from exact consumed inventory lots;
- `services_delivered_movements` plus `service_correction_movements` for net performed service quantity.

Material expense is assigned to a service only when the expense movement has an explicit `booking_id`. The booking is joined inside the same organization and supplies the service code. Expense without a booking is shown separately as unlinked material expense and is never allocated heuristically.

## Meaning of margin

`material contribution = net service revenue - linked material acquisition cost`

`material margin % = material contribution / net service revenue`

The percentage is deliberately absent when net revenue is zero or negative.

This is **not full accounting profit**. Payroll, equipment depreciation, electricity, maintenance, rent and other overhead are not allocated by this report. A future full-cost model must introduce explicit cost drivers rather than silently distributing those costs.

## Period and tenant rules

Revenue, expense and execution movements are included by their own immutable `occurred_at` date. The maximum report period is 366 days. Every query is scoped to the organization derived from the authenticated staff session; the browser cannot choose an organization ID.

The report is administrator-only, does not return patient identity fields, uses `cache-control: no-store`, and audits only period/scope/row-count metadata without patient or booking identifiers.
