# Studies performed register

RadiologyOS exposes `studies_performed` as the canonical business-core register for the operational fact that an imaging study was performed.

## Current compatibility projection

Until the dedicated `study_performance` business document becomes the physical registrar, the register is projected from the immutable movements already produced by the completion/storno lifecycle:

- `services_delivered_movements` contributes positive performed-study facts;
- `service_correction_movements` contributes explicit negative storno facts.

The projection never infers completion from mutable booking fields and never rewrites historical movements.

The staff register-turnover API exposes this projection as `registers.studies` with:

- `increase` — performed studies in the selected period;
- `decrease` — explicitly reversed studies;
- `net` — performed minus reversed studies;
- `regionsNet` — net anatomical-region count.

`breakdowns.studiesByService` exposes the same performed/reversed/net counts grouped by service code. The pre-existing `registers.services` field remains available as a backward-compatible projection over the same immutable movement union.

## Security and tenancy

The projection is calculated only for the current organization and inherits the existing report authorization boundary. It does not expose patient names, phone numbers, report/protocol text, or other medical content.

## Next architectural step

A later block will introduce the dedicated `study_performance` document/registrar and move ownership of operational study facts there. That transition must preserve existing immutable history and must not duplicate study, equipment-load, or staff-output movements.
