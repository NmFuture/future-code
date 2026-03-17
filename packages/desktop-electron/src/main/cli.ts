import type { EventEmitter } from "node:events"

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

function handleSqliteProgress(events: EventEmitter, line: string) {
  const stripped = line.startsWith("sqlite-migration:") ? line.slice("sqlite-migration:".length).trim() : null
  if (!stripped) return false
  if (stripped === "done") {
    events.emit("sqlite", { type: "Done" })
    return true
  }
  const value = Number.parseInt(stripped, 10)
  if (!Number.isNaN(value)) {
    events.emit("sqlite", { type: "InProgress", value })
    return true
  }
  return false
}
