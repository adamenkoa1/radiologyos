import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bookingCapacityLocks = sqliteTable("booking_capacity_locks", {
  organizationId: integer("organization_id").notNull().default(1),
  equipmentId: text("equipment_id").notNull(),
  bookingDate: text("booking_date").notNull(),
  minute: text("minute").notNull(),
  bookingCode: text("booking_code").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  primaryKey({ columns: [table.organizationId, table.equipmentId, table.bookingDate, table.minute] }),
  index("booking_capacity_locks_booking_idx").on(table.organizationId, table.bookingCode),
]);

export const bookingMinuteOffsets = sqliteTable("booking_minute_offsets", {
  minuteOffset: integer("minute_offset").primaryKey(),
});
