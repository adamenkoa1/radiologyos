# Unified BAS document journal

The internal workspace exposes one read-only journal over canonical `business_documents` and their typed registrar/detail tables. It does **not** create a second relationship table or copy balances.

## Journal identity

The journal keeps the physical `business_documents.document_type` but derives a display `journalType` when a typed detail gives the document a more precise meaning. For example, a service storno is stored in the `service_delivery` document family but is displayed as `service_correction` because it has `service_correction_details`.

## Structure of subordination

Relationships are read from existing canonical fields:

- `service_correction_details.source_document_id` → storno source;
- `finance_document_details.source_document_id` → refund source payment;
- `business_documents.reversed_document_id` → generic reversal source.

The journal can therefore show both “basis/source” and “derived documents” without maintaining duplicate graph data.

## Document movements

Opening a document reads only movements whose `(organization_id, document_id)` matches that exact document from these registrars:

- cash;
- patient settlements;
- revenue;
- rendered services;
- service corrections;
- equipment load;
- staff output;
- inventory.

Printed-form snapshots are shown alongside the document as immutable evidence.

## Security boundary

The journal is tenant-scoped in every query. Because the current journal includes patient-level financial/business evidence, access is initially limited to the existing finance capability (`admin` / `registrar`). Clinical-only roles do not receive this aggregate business view. Future subsystem-specific visibility can narrow or expand individual document families without changing the journal model.
