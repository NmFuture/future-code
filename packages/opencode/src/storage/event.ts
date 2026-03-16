import z from "zod"
import type { ZodObject } from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "../project/instance"
import { Bus as ProjectBus } from "@/bus"
import { Database, eq, max } from "./db"
import { EventSequenceTable, EventTable } from "./event.sql"
import { EventEmitter } from "events"

export namespace DatabaseEvent {
  export type Definition = {
    type: string
    properties: ZodObject
    version: string
    aggregateField: string
  }

  const registry = new Map<string, Definition>()
  const projectors = new Map<Definition, (db: Database.TxOrDb, data: unknown) => void>()

  export type BusEvent = {
    type: string
    data: {
      seq: number
      aggregateId: string
      data: Record<string, unknown>
    }
  }

  export const Bus = new EventEmitter<{
    event: [BusEvent]
  }>()

  function versionedName(type: string, version: string) {
    return `${type}.${version}`
  }

  function hasInstance() {
    try {
      Instance.project
      return true
    } catch (err) {
      return false
    }
  }

  export function define<Type extends string, Properties extends ZodObject<{ id: z.ZodString }>>(
    type: Type,
    version: string,
    properties: Properties,
  ) {
    return agg("id").define(type, version, properties)
  }

  export function agg<F extends string>(aggregateField: F) {
    return {
      define<Type extends string, Properties extends ZodObject<Record<F, z.ZodString>>>(
        type: Type,
        version: string,
        properties: Properties,
      ) {
        const def = {
          ...BusEvent.define(type, properties),
          version,
          aggregateField,
        }
        registry.set(versionedName(def.type, def.version), def)
        return def
      },
    }
  }

  export function addProjector<Def extends Definition>(
    event: Def,
    func: (db: Database.TxOrDb, data: z.output<Def["properties"]>) => void,
  ) {
    projectors.set(event, func as (db: Database.TxOrDb, data: unknown) => void)
  }

  function process<Def extends Definition>(
    event: Def,
    input: { seq: number; aggregateId: string; data: z.output<Def["properties"]> },
  ) {
    const projector = projectors.get(event)
    if (!projector) {
      throw new Error(`Projector not found for event: ${event.type}`)
    }

    // idempotent

    Database.transaction((tx) => {
      projector(tx, input.data)
      tx.insert(EventSequenceTable)
        .values({
          aggregate_id: input.aggregateId,
          seq: input.seq,
        })
        .onConflictDoUpdate({
          target: EventSequenceTable.aggregate_id,
          set: { seq: input.seq },
        })
        .run()
      tx.insert(EventTable)
        .values({
          seq: input.seq,
          aggregateId: input.aggregateId,
          name: versionedName(event.type, event.version),
          data: input.data as Record<string, unknown>,
        })
        .run()
    })
  }

  // TODO:
  //
  // * Support applying multiple events at one time. One transaction,
  //   and it validets all the sequence ids
  // * when loading events from db, apply zod validation to ensure shape

  export function replay(event: BusEvent) {
    const def = registry.get(event.type)
    if (!def) {
      throw new Error(`Unknown event type: ${event.type}`)
    }

    const maxSeq = Database.use((db) =>
      db
        .select({ val: max(EventTable.seq) })
        .from(EventTable)
        .where(eq(EventTable.aggregateId, event.data.aggregateId))
        .get(),
    )

    const expected = maxSeq ? maxSeq.val! + 1 : 0
    if (event.data.seq !== expected) {
      throw new Error(
        `Sequence mismatch for aggregate "${event.data.aggregateId}": expected ${expected}, got ${event.data.seq}`,
      )
    }

    process(def, event.data)
  }

  export function run<Def extends Definition>(event: Def, data: z.output<Def["properties"]>) {
    const agg = data[event.aggregateField] as string
    // This should never happen: we've enforced it via typescript
    if (agg == null) {
      throw new Error(`DatabaseEvent: "${event.aggregateField}" required but not found: ${JSON.stringify(event)}`)
    }

    Database.immediateTransaction((tx) => {
      const row = tx
        .select({ seq: EventSequenceTable.seq })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, agg))
        .get()
      const seq = (row?.seq ?? 0) + 1
      process(event, { seq, aggregateId: agg, data })

      Database.effect(() => {
        if (hasInstance()) {
          ProjectBus.publish(event, data)
        }

        Bus.emit("event", {
          type: versionedName(event.type, event.version),
          data: {
            seq: seq,
            aggregateId: agg,
            data: data,
          },
        })
      })
    })
  }
}
