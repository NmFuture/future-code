import z from "zod"
import type { ZodObject } from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Database, eq, max } from "./db"
import { EventSequenceTable, EventTable } from "./event.sql"

export namespace DatabaseEvent {
  export type Definition = {
    type: string
    properties: ZodObject<{ seq: z.ZodNumber; aggregateId: z.ZodString; data: z.ZodObject }>
    version: string
    aggregateField: string
  }

  export type Event<Def extends Definition = Definition> = {
    seq: number
    aggregateId: string
    data: z.infer<Def["properties"]>["data"]
  }

  export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

  const projectors = new Map<Definition, (db: Database.TxOrDb, data: unknown) => void>()
  const registry = new Map<string, Definition>()

  export function versionedName(type: string, version?: string) {
    return version ? `${type}.${version}` : type
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
      define<Type extends string, Data extends ZodObject<Record<F, z.ZodString>>>(
        type: Type,
        version: string,
        data: Data,
      ) {
        const def = {
          type,
          properties: z.object({ seq: z.number(), aggregateId: z.string(), data }),
          version,
          aggregateField,
        }

        registry.set(versionedName(def.type, def.version), def)
        BusEvent.define(versionedName(def.type, def.version), def.properties)

        return def
      },
    }
  }

  export function addProjector<Def extends Definition>(
    def: Def,
    func: (db: Database.TxOrDb, data: Event<Def>["data"]) => void,
  ) {
    projectors.set(def, func as (db: Database.TxOrDb, data: unknown) => void)
  }

  function process<Def extends Definition>(def: Def, input: Event<Def>) {
    const projector = projectors.get(def)
    if (!projector) {
      throw new Error(`Projector not found for event: ${def.type}`)
    }

    // idempotent: need to ignore any events already logged

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
          name: versionedName(def.type, def.version),
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

  export function replay(event: SerializedEvent) {
    const def = registry.get(event.type)
    if (!def) {
      console.log(registry)
      throw new Error(`Unknown event type: ${event.type}`)
    }

    const maxSeq = Database.use((db) =>
      db
        .select({ val: max(EventTable.seq) })
        .from(EventTable)
        .where(eq(EventTable.aggregateId, event.aggregateId))
        .get(),
    )

    const expected = maxSeq?.val ? maxSeq.val + 1 : 0
    if (event.seq !== expected) {
      throw new Error(`Sequence mismatch for aggregate "${event.aggregateId}": expected ${expected}, got ${event.seq}`)
    }

    process(def, event)
  }

  export function run<Def extends Definition>(def: Def, data: Event<Def>["data"]) {
    const agg = (data as Record<string, string>)[def.aggregateField]
    // This should never happen: we've enforced it via typescript in
    // the definition
    if (agg == null) {
      throw new Error(`DatabaseEvent: "${def.aggregateField}" required but not found: ${JSON.stringify(event)}`)
    }

    Database.immediateTransaction((tx) => {
      const row = tx
        .select({ seq: EventSequenceTable.seq })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, agg))
        .get()
      const seq = (row?.seq ?? 0) + 1
      process(def, { seq, aggregateId: agg, data })

      Database.effect(() => {
        const versionedDef = { ...def, type: versionedName(def.type, def.version) }
        Bus.publish(versionedDef, { seq, aggregateId: agg, data } as z.output<Def["properties"]>)
      })
    })
  }
}
