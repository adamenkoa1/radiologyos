-- SQLite composite foreign keys must target an exact UNIQUE parent-key column order.
-- `id` remains the PK; this key exists specifically for (document_id, organization_id) tenant-safe FKs.
CREATE UNIQUE INDEX IF NOT EXISTS `business_documents_id_org_idx`
  ON `business_documents` (`id`,`organization_id`);