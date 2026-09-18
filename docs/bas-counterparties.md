# BAS Counterparties and supplier references

`counterparty` is a real tenant-scoped reference in the RadiologyOS business core. The first consumer is warehouse receipt (`inventory_receipt`).

## Identity and snapshot

A new receipt can point to `counterparties.id` through `supplier_counterparty_id`. The document line also stores the supplier name in the existing `supplier` field as the historical snapshot selected at document creation.

This separation is deliberate:

- `supplier_counterparty_id` answers **which counterparty** the document refers to;
- `supplier` answers **what supplier name was recorded on this document**;
- renaming or deactivating the directory entry never rewrites a posted receipt, lot or printed form;
- legacy free-text supplier values remain valid with a null reference; they are never guessed/backfilled into counterparties.

## Supplier rules

- references are tenant scoped;
- only active `supplier` / `both` counterparties may be selected for a new receipt;
- a prepared draft may still be posted if the counterparty is later renamed/deactivated because the document already owns its snapshot;
- a payer-only counterparty cannot be used as a warehouse supplier;
- referenced counterparties are retired with `active=0`, not deleted from historical evidence.

## Printed forms

The existing inventory print engine renders the line-level `supplier` snapshot into the immutable `printed_form_snapshots` payload. Reprinting a posted receipt therefore reproduces the historical supplier name even after the master-data record changes.

## Boundary

This is operational master data, not tax/accounting automation. Counterparty balances, purchase invoices, VAT and statutory accounting are outside this slice.
