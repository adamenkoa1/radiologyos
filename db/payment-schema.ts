import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const paymentTransactions = sqliteTable("payment_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull(),
  bookingId: integer("booking_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("UAH"),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  paidAt: text("paid_at").notNull().default(""),
  refundedAt: text("refunded_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  paymentDocumentId: integer("payment_document_id"),
  refundDocumentId: integer("refund_document_id"),
}, table => [
  index("payment_transactions_booking_idx").on(table.organizationId, table.bookingId, table.createdAt),
  uniqueIndex("payment_transactions_provider_ref_idx")
    .on(table.organizationId, table.provider, table.providerReference)
    .where(sql`provider_reference != ''`),
  uniqueIndex("payment_transactions_payment_document_idx")
    .on(table.organizationId, table.paymentDocumentId)
    .where(sql`payment_document_id IS NOT NULL`),
  uniqueIndex("payment_transactions_refund_document_idx")
    .on(table.organizationId, table.refundDocumentId)
    .where(sql`refund_document_id IS NOT NULL`),
  uniqueIndex("payment_transactions_one_linked_paid_booking_idx")
    .on(table.organizationId, table.bookingId)
    .where(sql`status = 'paid' AND payment_document_id IS NOT NULL`),
]);
