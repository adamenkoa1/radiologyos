# BAS service-delivery journal

`service_delivery` is the authoritative document for a performed service. The staff journal at `/staff/finance/services` reads posted service-delivery documents rather than reconstructing the business fact from bookings.

## Printed act

`service_act` uses the shared `printed_form_snapshots` evidence store.

- first print of a posted/reversed document captures the render payload and SHA-256;
- later reprints reuse the same snapshot for the same document state and template version;
- snapshots are append-only and cannot be updated or deleted;
- D1 validates that the captured payload matches the exact service-delivery registrar, booking, tenant and service values at generation time;
- a foreign tenant cannot read or generate the act;
- the act is a finance/business document and does not replace the medical protocol or result.

## Accounting boundary

The act displays the `charge_amount` from the posted service-delivery registrar. A payment receipt is a separate printed form for a separate `payment`/`refund` document. Printing an act never creates or changes revenue, cash or settlement movements.
