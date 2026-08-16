# BAS register turnover and balance report

`/staff/reports/registers` is a read-only report layer over immutable movement ledgers. It deliberately does not calculate finance from bookings or manually maintained KPI fields.

## Period semantics

The report accepts an inclusive `from` / `to` calendar period up to 366 days. A movement belongs to the period by its own registrar timestamp. Therefore a service performed in one period and storno posted in another correctly appear in different turnovers.

## Registers

- Revenue: accrued service revenue, storno, net turnover.
- Cash: incoming payments, outgoing refunds, net cash movement.
- Patient settlements: opening balance, increases, decreases, period net, closing balance. Positive balance means patients owe the organization; negative means patient credit.
- Services: performed service count and storno count, including net anatomical regions.
- Equipment load: positive performed minutes and negative storno minutes.
- Staff output: performed units and storno units.
- Inventory: opening quantity, receipts, issues, closing quantity per item/unit.

## Boundaries

Service storno changes revenue/settlements/operations but never cash. Refund changes cash and settlements but is a separate document. The report preserves that separation because each number comes from its own register.

The report is aggregate and currently uses the existing `canViewReports` authority (`admin`). All queries are tenant-scoped. No report endpoint mutates documents, balances or movements.
