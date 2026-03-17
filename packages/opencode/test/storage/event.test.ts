import { describe, test, expect, beforeEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import z from "zod"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { DatabaseEvent } from "../../src/storage/event"
import { Database } from "../../src/storage/db"
import { EventTable } from "../../src/storage/event.sql"
import { Identifier } from "../../src/id/id"

beforeEach(() => {
  Database.Client.reset()
})

function withInstance(fn: () => void | Promise<void>) {
  return async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fn()
      },
    })
  }
}

describe("DatabaseEvent", () => {
  const Created = DatabaseEvent.define("item.created", "v1", z.object({ id: z.string(), name: z.string() }))
  const Sent = DatabaseEvent.agg("item_id").define("item.sent", "v1", z.object({ item_id: z.string(), to: z.string() }))

  DatabaseEvent.addProjector(Created, () => {})
  DatabaseEvent.addProjector(Sent, () => {})

  describe("run", () => {
    test(
      "inserts event row",
      withInstance(() => {
        DatabaseEvent.run(Created, { id: "msg_1", name: "first" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe("item.created.v1")
        expect(rows[0].aggregateId).toBe("msg_1")
      }),
    )

    test(
      "increments seq per aggregate",
      withInstance(() => {
        DatabaseEvent.run(Created, { id: "msg_1", name: "first" })
        DatabaseEvent.run(Created, { id: "msg_1", name: "second" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(2)
        expect(rows[1].seq).toBe(rows[0].seq + 1)
      }),
    )

    test(
      "uses custom aggregate field from agg()",
      withInstance(() => {
        DatabaseEvent.run(Sent, { item_id: "msg_1", to: "james" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].aggregateId).toBe("msg_1")
      }),
    )

    test(
      "emits events",
      withInstance(() => {
        const events: Array<{
          type: string
          properties: { seq: number; aggregateId: string; data: { id: string; name: string } }
        }> = []
        const unsub = Bus.subscribeAll((event) => events.push(event))

        DatabaseEvent.run(Created, { id: "msg_1", name: "test" })

        expect(events).toHaveLength(1)
        expect(events[0]).toEqual({
          type: "item.created.v1",
          properties: {
            seq: 1,
            aggregateId: "msg_1",
            data: {
              id: "msg_1",
              name: "test",
            },
          },
        })

        unsub()
      }),
    )
  })

  describe("replay", () => {
    test(
      "inserts event from external payload",
      withInstance(() => {
        const id = Identifier.descending("message")
        DatabaseEvent.replay({
          type: "item.created.v1",
          seq: 0,
          aggregateId: id,
          data: { id, name: "replayed" },
        })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].aggregateId).toBe(id)
      }),
    )

    test(
      "throws on sequence mismatch",
      withInstance(() => {
        const id = Identifier.descending("message")
        DatabaseEvent.replay({
          type: "item.created.v1",
          seq: 0,
          aggregateId: id,
          data: { id, name: "first" },
        })
        expect(() =>
          DatabaseEvent.replay({
            type: "item.created.v1",
            seq: 5,
            aggregateId: id,
            data: { id, name: "bad" },
          }),
        ).toThrow(/Sequence mismatch/)
      }),
    )

    test(
      "throws on unknown event type",
      withInstance(() => {
        expect(() =>
          DatabaseEvent.replay({
            type: "unknown.event.1",
            seq: 0,
            aggregateId: "x",
            data: {},
          }),
        ).toThrow(/Unknown event type/)
      }),
    )
  })
})
