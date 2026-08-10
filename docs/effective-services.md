# Effective service source of truth

RadiologyOS resolves a service on the server through `lib/effective-services.ts`. Consumers must not independently combine `lib/catalog.ts`, service settings and tariff storage.

## System seed properties

The static catalog is the stable seed/fallback and owns:

- `code` — stable service identifier;
- `title` — canonical service name;
- `group` — catalog grouping;
- `description` — canonical explanatory text;
- default equipment, duration and price used only when the organization has no override.

Service codes are system constants. Organization configuration cannot add unknown codes or duplicate a code.

## Organization-effective properties

For each organization the effective resolver owns:

- `active`;
- civilian visibility;
- military visibility;
- `equipmentId`;
- `durationMinutes`;
- `price`;
- `requiresBooking`.

Service configuration is stored under `service_catalog_config_v1:org:<organizationId>`. Tariff overrides are stored under `service_price_overrides_v1:org:<organizationId>`. Legacy global configuration and the legacy `service_prices` table are migration fallbacks for the initial organization only.

Invalid equipment identifiers, unknown or duplicate service codes, and invalid durations are rejected before persistence.

## Consumer invariant

The public service list, public catalog, public booking APIs, availability, staff booking UI and staff booking mutations must use `effectiveServices()` or `effectiveServiceByCode()`.

A disabled service or a service hidden from the selected patient category must be rejected server-side even if a client calls the booking endpoint directly.

Availability derives the organization from a verified staff session for staff requests. Anonymous storefront requests currently resolve to the initial public organization until host/slug based public tenant routing is introduced. The browser cannot choose `organization_id`.

## Booking snapshots

When a booking is created, RadiologyOS stores the resolved service title/code, equipment, duration and payment amount on the booking. Those values are a historical snapshot. Later tariff or service configuration changes affect new bookings and explicit service changes, but do not silently rewrite existing bookings.

When staff explicitly changes the service on an existing booking, the new effective service is resolved for that organization, availability is revalidated, and the new price is captured unless finance is already locked by a completed payment state.
