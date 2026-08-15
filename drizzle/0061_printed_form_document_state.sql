-- Enables exact historical reprint of the first generated form for each immutable document state.
ALTER TABLE `printed_form_snapshots` ADD COLUMN `document_state` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `printed_form_snapshots_state_idx`
  ON `printed_form_snapshots` (`organization_id`,`document_id`,`form_type`,`template_version`,`document_state`,`id` DESC);