import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly branch: () => Effect.Effect<string | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let current: string | undefined

      if (instance.project.vcs === "git") {
        const currentBranch = async () => {
          const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: instance.project.worktree,
          })
          if (result.exitCode !== 0) return undefined
          const text = result.text().trim()
          return text || undefined
        }

        current = yield* Effect.promise(() => currentBranch())
        log.info("initialized", { branch: current })

        const unsubscribe = Bus.subscribe(
          FileWatcher.Event.Updated,
          Instance.bind(async (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            const next = await currentBranch()
            if (next !== current) {
              log.info("branch changed", { from: current, to: next })
              current = next
              Bus.publish(Event.BranchUpdated, { branch: next })
            }
          }),
        )

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
      }

      return Service.of({
        branch: Effect.fn("Vcs.branch")(function* () {
          return current
        }),
      })
    }),
  )
}
