# BAS cash accounts

`cash_account` is now a real tenant-scoped reference and a first-class dimension of the `cash` register.

## Reference model

Each organization receives two operational defaults when the migration is applied and when a new tenant is created:

- `CASH-UAH` — `Основна каса`, type `cash`, UAH;
- `BANK-UAH` — `Основний банківський рахунок`, type `bank`, UAH.

Administrators can add other cash, bank, provider or other accounts and choose one active default per type/currency. Registrars can read the directory but cannot change financial master data.

## Document and register semantics

New payment documents always resolve a concrete account:

- payment method `cash` → active default cash account;
- card, bank transfer, Privat24 and payment providers → active default bank account;
- staff reconciliation may explicitly choose another active same-tenant account in the same currency.

`finance_document_details` freezes three values at document creation:

- `cash_account_id` — stable reference identity;
- `cash_account_name` — historical name snapshot;
- `cash_account_code` — historical code snapshot.

The same three values are copied to `cash_movements` and are part of the D1 exact registrar contract.

## Refunds

A refund with a BAS source payment inherits the exact account identity and historical account snapshot from that payment. Renaming, deactivating, or changing the current default after the payment cannot redirect the refund to another account.

Legacy source documents without an account remain compatible and resolve a current operational default when a new refund must be created.

## History and printing

Historical finance rows are not backfilled. Old rows may keep a null account and are displayed as legacy/unassigned.

Payment receipt template v2 includes the document's frozen account name/code. For a posted document that was already printed, reprint uses the earliest immutable snapshot regardless of the current template version, so an old v1 form remains an exact v1 historical reproduction.

## Boundary

This is operational cash/bank tracking for RadiologyOS. It does not implement statutory bank statements, fiscal cash registers, VAT, tax accounting, or bank reconciliation automation.
