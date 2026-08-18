# Appointment registrar

`appointment` is the immutable scheduling-history document for future bookings. The mutable `bookings` row remains the operational projection used by calendar/availability APIs.

## Lifecycle

- A booking created after migration 0095 first receives its Patient Order. Inserting that typed Patient Order detail is the deterministic hook that creates posted Appointment v1.
- Appointment v1 is based on the exact same-tenant Patient Order.
- A real change to patient/service/equipment/duration/date/time reverses the current posted appointment and creates the next posted version based on the previous appointment. A no-op update creates nothing.
- Booking cancellation reverses the current appointment and creates no replacement.
- Booking completion leaves the last posted appointment unchanged as the fulfilled scheduling fact.
- Existing bookings are not backfilled and do not enter appointment versioning merely because migration 0095 was installed.

The document chain is therefore `Patient Order -> Appointment v1 -> Appointment v2 -> ...`. This block intentionally keeps `service_delivery` based directly on Patient Order; changing execution lineage is a separate architecture decision after appointment semantics are proven.

## Snapshot and integrity

Each version stores booking id, patient id, service code/title, equipment, duration, scheduled date/time and a monotonically increasing version. D1 generates the typed snapshot from the canonical booking; API code does not submit appointment facts. Wrong tenant/basis/version/snapshot, duplicate active history, direct independent reversal, and snapshot mutation are rejected. Appointment documents post no finance, inventory, service, equipment-load or staff-output movements.
