import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  desiredDate: text("desired_date").notNull(),
  desiredTime: text("desired_time").notNull(),
  referral: text("referral").notNull().default("Уточню у адміністратора"),
  comment: text("comment").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
