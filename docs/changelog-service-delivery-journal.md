## Service-delivery journal and act

- Added a dedicated BAS-style journal for posted `service_delivery` documents.
- Added immutable `service_act` printed snapshots with SHA-256 and exact historical reprint.
- Service acts are tenant- and finance-role scoped and cannot mutate accounting registers.
- D1 rejects a `service_act` payload that does not match the posted service-delivery registrar.
