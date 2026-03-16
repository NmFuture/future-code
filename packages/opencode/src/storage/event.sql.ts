import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
})

export const EventTable = sqliteTable("event", {
  seq: integer().notNull(),
  aggregateId: text()
    .notNull()
    .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
  name: text().notNull(),
  data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
})
