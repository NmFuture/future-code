import path from "path"
import { Log } from "../util/log"
import { TRUNCATION_DIR } from "./truncation-dir"
import { Identifier } from "../id/id"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, FileSystem, Layer, Schedule, ServiceMap } from "effect"

const log = Log.create({ service: "truncation" })
const RETENTION = Duration.days(7)

export namespace TruncateService {
  export interface Service {
    readonly cleanup: () => Effect.Effect<void>
  }
}

export class TruncateService extends ServiceMap.Service<TruncateService, TruncateService.Service>()(
  "@opencode/Truncate",
) {
  static readonly layer = Layer.effect(
    TruncateService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      const cleanup = Effect.fn("TruncateService.cleanup")(function* () {
        const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - Duration.toMillis(RETENTION)))
        const entries = yield* fs
          .readDirectory(TRUNCATION_DIR)
          .pipe(
            Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
            Effect.catch(() => Effect.succeed([])),
          )
        for (const entry of entries) {
          if (Identifier.timestamp(entry) >= cutoff) continue
          yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
        }
      })

      // Start hourly cleanup — scoped to runtime lifetime
      yield* cleanup().pipe(
        Effect.catchCause((cause) => {
          log.error("truncation cleanup failed", { cause: Cause.pretty(cause) })
          return Effect.void
        }),
        Effect.repeat(Schedule.spaced(Duration.hours(1))),
        Effect.forkScoped,
      )

      return TruncateService.of({ cleanup })
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer), Layer.provide(NodePath.layer))
}
