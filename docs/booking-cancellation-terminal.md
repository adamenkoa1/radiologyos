# Terminal booking cancellation

`bookings.status = 'cancelled'` is a terminal business-core state.

The booking row is an operational projection, but cancellation already closes its draft Patient Order and reverses the active Appointment. Reopening that same row would therefore resurrect an operational object whose immutable business-document history remains closed.

Migration `0096_booking_cancellation_terminal.sql` rejects every `cancelled -> non-cancelled` status transition at the D1 boundary. Ordinary cancellation and an idempotent `cancelled -> cancelled` write remain valid.

If a cancelled visit must be scheduled again, the system must create a new booking. That new booking receives a new Patient Order and a new Appointment lineage; the cancelled booking remains historical evidence.

This invariant intentionally lands before the separate `Appointment -> service_delivery` execution-lineage change, so execution can never be attached to a resurrected cancelled schedule.
