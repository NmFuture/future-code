import { Bus } from "@/bus"
import { Database, NotFoundError, eq, and } from "../storage/db"
import { DatabaseEvent } from "@/storage/event"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"

DatabaseEvent.addProjector(Session.Event.Created, (db, data) => {
  const existing = db
    .select({ id: ProjectTable.id })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, data.info.projectID))
    .get()
  if (!existing) {
    // Create a (temporary) project to make this work. In the future
    // we should separate sessions and projects
    db.insert(ProjectTable)
      .values({
        id: data.info.projectID,
        worktree: data.info.directory,
        sandboxes: [],
      })
      .run()
  }

  db.insert(SessionTable).values(Session.toRow(data.info)).run()
})

DatabaseEvent.addProjector(Session.Event.Shared, (db, data) => {
  const row = db.update(SessionTable).set({ share_url: data.url }).where(eq(SessionTable.id, data.id)).returning().get()
  if (!row) throw new NotFoundError({ message: `Session not found: ${data.id}` })
  const info = Session.fromRow(row)
})

DatabaseEvent.addProjector(Session.Event.Touch, (db, data) => {
  const row = db
    .update(SessionTable)
    .set({ time_updated: data.time })
    .where(eq(SessionTable.id, data.id))
    .returning()
    .get()
  if (!row) throw new NotFoundError({ message: `Session not found: ${data.id}` })

  // const info = Session.fromRow(row)
  // Database.effect(() => Bus.publish(Event.Updated, { id: data.id, info }))
})

DatabaseEvent.addProjector(Session.Event.Deleted, (db, data) => {
  db.delete(SessionTable).where(eq(SessionTable.id, data.id)).run()
})

DatabaseEvent.addProjector(MessageV2.Event.Updated, (db, data) => {
  const time_created = data.info.time.created
  const { id, sessionID, ...rest } = data.info

  db.insert(MessageTable)
    .values({
      id,
      session_id: sessionID,
      time_created,
      data: rest,
    })
    .onConflictDoUpdate({ target: MessageTable.id, set: { data: rest } })
    .run()
})

DatabaseEvent.addProjector(MessageV2.Event.Removed, (db, data) => {
  db.delete(MessageTable)
    .where(and(eq(MessageTable.id, data.messageID), eq(MessageTable.session_id, data.sessionID)))
    .run()
})

DatabaseEvent.addProjector(MessageV2.Event.PartRemoved, (db, data) => {
  db.delete(PartTable)
    .where(and(eq(PartTable.id, data.partID), eq(PartTable.session_id, data.sessionID)))
    .run()
})

DatabaseEvent.addProjector(MessageV2.Event.PartUpdated, (db, data) => {
  const { id, messageID, sessionID, ...rest } = data.part

  db.insert(PartTable)
    .values({
      id,
      message_id: messageID,
      session_id: sessionID,
      time_created: data.time,
      data: rest,
    })
    .onConflictDoUpdate({ target: PartTable.id, set: { data: rest } })
    .run()
})
