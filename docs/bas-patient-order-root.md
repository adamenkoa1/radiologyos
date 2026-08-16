# BAS Patient Order root

`patient_order` (`ЗП-xxxxxx`) is the commercial root for every **new** booking created after this migration. Existing historical bookings are not backfilled: RadiologyOS does not invent retrospective business documents.

## Lifecycle

1. Inserting a new booking automatically creates one draft Patient Order in D1.
2. While the order is draft, commercial booking fields keep its typed snapshot synchronized.
3. The first posted payment or completed study posts/freezes the Patient Order.
4. After the order is posted, commercial terms cannot drift through booking edits. Appointment time may still be rescheduled because scheduling is not a commercial order term.
5. A service-delivery registrar then points to the Patient Order as its canonical basis.

## Canonical document basis

`business_documents.basis_document_id` is a tenant-scoped, immutable part of document identity after posting.

For the new BAS contour:

- `patient_order` → no basis;
- `payment` → Patient Order;
- `service_delivery` → Patient Order;
- `refund` → source Payment;
- `service_correction` → source Service Delivery.

Typed D1 triggers assign and validate those links. API code does not get to invent the graph. Legacy bookings without a Patient Order may continue to create legacy-compatible payment/service registrars with no order basis; no automatic historical adoption is performed.

## Patient Order snapshot

The typed detail stores the business terms needed to explain downstream finance/operations:

- booking id;
- patient id when already known;
- patient category;
- service code/title;
- equipment;
- duration;
- price;
- charge amount (`0` for military/free route);
- currency.

Appointment date/time deliberately stays outside this immutable commercial snapshot so a paid patient can be rescheduled without rewriting the order.

## Security and integrity

- one Patient Order per tenant/booking;
- basis cannot cross tenants or self-reference;
- wrong basis type is rejected by D1;
- payment/service basis must match the exact booking's Patient Order;
- refund basis must be the source payment;
- storno basis must be the exact source service-delivery document;
- typed basis is frozen once its detail exists;
- after posting, generic document immutability also freezes both `basis_document_id` and `reversed_document_id`.

The unified business-document journal reads this same basis field to show the document tree without maintaining a second relation store.
