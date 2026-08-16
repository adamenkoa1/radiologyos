# BAS warehouses / stock locations

RadiologyOS treats a warehouse as a tenant-scoped master-data reference and as an explicit dimension of the inventory register.

## Core rule

A lot/batch is not owned by one warehouse. The same lot may have stock in several warehouses. Stock truth is therefore calculated by:

`organization + warehouse + item + lot`

Receipt and write-off documents freeze the selected warehouse identity (`warehouse_id`) plus its human-readable code/name snapshot. Posted register movements copy the exact same warehouse identity and snapshot.

## Default warehouse and migration

Migration `0081_warehouses.sql` creates one active default warehouse (`MAIN`, `Основний склад`) for every existing organization and automatically seeds it for newly created organizations.

Pre-0081 inventory rows are assigned to this default warehouse. This is deterministic, not heuristic: the previous schema could represent only one implicit stock location for the whole organization, so there is no alternative historical location to infer.

New document lines must always reference an active warehouse. API callers that omit `warehouseId` resolve to the active default warehouse, which preserves compatibility with existing receipt/write-off callers.

## Posting invariants

- receipt creates a positive movement in the selected warehouse;
- write-off creates a negative movement in the selected warehouse;
- another warehouse's stock can never satisfy a write-off;
- the D1 non-negative-stock trigger evaluates `warehouse + lot` atomically;
- linked movements must match the posted document line exactly, including warehouse id/code/name;
- movements remain append-only and are never rewritten after posting.

## Master-data lifecycle

Warehouses are tenant scoped. Only administrators change the directory; staff may read it for inventory work.

A warehouse can be renamed or deactivated, but posted documents/movements keep the historical warehouse snapshot. Referenced warehouses cannot be physically deleted. One active default warehouse is maintained by the application-level directory workflow.

## Printed forms

Inventory printed-form template version 2 includes the frozen warehouse id/code/name from the document line. Reprinting a posted document reuses the canonical immutable snapshot for that template/state, so later warehouse renames do not alter the historical form.

## Deliberately out of scope

`inventory_transfer` is not enabled in this block. The schema is prepared for it conceptually: a future transfer document will post a negative movement from one warehouse and a positive movement into another rather than changing a lot's identity.

Production deployment is not part of this PR.
