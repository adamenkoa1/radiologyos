# ADR 0001: Multi-tenant foundation

- Status: accepted
- Date: 2026-07-29

## Context

RadiologyOS started as a system for one radiology department. The product is
now intended to become a configurable platform for hospitals, clinics, dental
offices and private diagnostic centres. Medical, operational and financial
records from different customers must never share an authorization or query
scope.

The first production profile remains:

- organization: Чернігівський військовий госпіталь;
- branch: Чернігівський військовий госпіталь;
- department: Відділення променевої діагностики;
- product profile: `hospital_radiology`;
- locale/timezone/currency: `uk-UA`, `Europe/Kyiv`, `UAH`.

## Decision

We introduce an explicit organization boundary:

1. `organizations` owns branches, departments and organization-scoped
   configuration.
2. A staff record is a global login identity. Access is granted through
   `organization_memberships`, where role, department and active status belong
   to a specific organization.
3. Every staff session is bound to one organization and department. The server
   resolves that context from the session; clients cannot override it on
   business-data requests.
4. Bookings, events, patient sessions, patient communication, protocols,
   imaging, reports and audit events carry `organization_id`.
5. Settings, tariffs, patient profiles and PACS settings use composite or
   organization primary keys, so a globally unique legacy key cannot mix
   tenants.
6. Public endpoints use a server-selected tenant context. The first release
   maps the current public site to the initial hospital tenant; host/slug based
   routing can be added without changing repository contracts.

Every repository query that reads or mutates tenant data must include
`organization_id`. Role checks are additional to, not a replacement for, the
organization boundary. In particular, an administrator can access all records
inside their organization, never records from another organization.

## Migration and rollback

Migration `0016_multi_tenant_foundation.sql` is additive:

- it creates organization tables;
- seeds the initial hospital, branch and radiology department;
- copies current staff, settings, tariffs, patient profiles and PACS settings
  into organization-scoped tables;
- adds non-null `organization_id` columns with the initial organization as the
  backfill default;
- adds composite indexes for common tenant queries.

Legacy singleton tables remain during the compatibility window. Runtime code
uses the organization-scoped replacements. Rollback is therefore performed by
deploying the previous application version; the migration does not delete
existing rows.

## Consequences

- A later organization switch must issue a new organization-bound session.
- New product profiles can compose modules without duplicating medical data
  models.
- Cross-tenant tests are required for every new data repository.
- Database uniqueness rules that are currently global because booking IDs are
  global may be converted to composite keys in a later table-rebuild migration.
- The current change does not add self-service tenant creation, billing or a
  tenant switcher. Those are separate product increments.
