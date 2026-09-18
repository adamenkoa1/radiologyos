# Service material requirements and inventory reservations

## Boundary

`inventory_reservations` is a planning register. It does not move physical stock and does not recognize expense.

- `service_material_requirements` defines how much of an inventory item a service plans to need from a warehouse.
- `inventory_reservation_movements` records reservation/release facts for a concrete Appointment version.
- `inventory_movements` remains the only physical stock ledger.
- `expense_movements` remains the only acquisition-cost expense ledger.

## Requirement lifecycle

Requirements are tenant-scoped and refer to a canonical service code, an inventory item and a warehouse. Their service/item/warehouse/quantity identity is immutable. To change a norm, deactivate the old row and create a new active row. Existing reservation history therefore never changes when planning rules change later.

Staff may read requirements for their organization. Only an administrator may create or deactivate them through the staff API. Administrative changes are security-audited with service/item/warehouse/quantity identifiers only; no booking or patient data is copied into audit details.

## Reservation lifecycle

Only future bookings that participate in immutable Appointment history are reserved; migration 0099 performs no historical backfill.

- Appointment creation appends `reserve` movements for every active requirement matching the Appointment service.
- Rescheduling reverses the old Appointment, releases its reservations, then the replacement Appointment receives fresh reservations.
- Cancellation releases reservations through Appointment reversal.
- Completion releases the planning hold while leaving physical consumption to a separate future registrar.

Reservations are maintained at `organization + warehouse + item` level, not at lot level. Lot selection remains a physical write-off/valuation concern.

## Stock invariants

A new reservation fails closed if physical on-hand stock minus active reservations would become negative. A physical write-off or transfer-out also fails if it would consume units reserved for other active planning facts. When there is no active reservation, the pre-existing canonical `inventory_negative_stock` guard remains the owner of ordinary negative-stock rejection.

Reservation rows are append-only and D1 validates the exact same-tenant Appointment, booking, requirement, service, item, warehouse, actor and signed quantity. There is no direct API for editing reservation movements.

## Deferred execution stage

This block deliberately does not synthesize `inventory_writeoff` documents from service completion. Converting a released reservation into actual material consumption and lot-valued expense is a separate execution-stage change and must preserve the existing inventory and expense registrars.
