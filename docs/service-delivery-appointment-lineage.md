# Appointment to service-delivery lineage

For bookings that entered the business core after Appointment versioning was introduced, the canonical document chain is:

`Patient Order -> Appointment(v1..vN) -> service_delivery -> study_performance`

The service-delivery registrar is attached to the exact latest posted Appointment for the same booking at the moment of execution. The typed `service_delivery_details` trigger owns this relation; callers cannot choose another Appointment, including one from the same tenant.

Compatibility remains deliberate:

- a pre-0095 booking that has a Patient Order but no Appointment history keeps `Patient Order -> service_delivery`;
- a truly legacy booking without Patient Order remains basis-less;
- service storno stays based on the exact service-delivery document it reverses;
- no historical document is backfilled or rewritten.

After a service-delivery detail exists, the booking's desired date/time is frozen. Otherwise a retrospective reschedule could reverse the Appointment that already serves as immutable execution evidence.
