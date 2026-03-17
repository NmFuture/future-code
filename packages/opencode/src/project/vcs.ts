import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { git } from "@/util/git"
import { Filesystem } from "@/util/filesystem"
import { Snapshot } from "@/snapshot"
import { Effect, Layer, ServiceMap } from "effect"
import path from "path"

const log = Log.create({ service: "vcs" })
const cfg = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

type Base = { name: string; ref: string }

async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>) {
  const size = Math.max(1, limit)
  const out: R[] = new Array(list.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, async () => {
      while (true) {
        const i = idx
        idx += 1
        if (i >= list.length) return
        out[i] = await fn(list[i]!)
      }
    }),
  )
  return out
}

function out(result: { text(): string }) {
  return result.text().trim()
}

async function run(cwd: string, args: string[]) {
  return git([...cfg, ...args], { cwd })
}

async function branch(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (result.exitCode !== 0) return
  const text = out(result)
  return text || undefined
}

async function prefix(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--show-prefix"])
  if (result.exitCode !== 0) return ""
  return out(result)
}

async function branches(cwd: string) {
  const result = await run(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  if (result.exitCode !== 0) return []
  return out(result)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

async function remoteHead(cwd: string, remote: string) {
  const result = await run(cwd, ["ls-remote", "--symref", remote, "HEAD"])
  if (result.exitCode !== 0) return
  for (const line of result.text().split("\n")) {
    const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line.trim())
    if (!match?.[1]) continue
    return { name: match[1], ref: `${remote}/${match[1]}` } satisfies Base
  }
}

async function primary(cwd: string) {
  const result = await run(cwd, ["remote"])
  const list =
    result.exitCode !== 0
      ? []
      : out(result)
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
  if (list.includes("origin")) return "origin"
  if (list.length === 1) return list[0]
  if (list.includes("upstream")) return "upstream"
  return list[0]
}

async function base(cwd: string) {
  const remote = await primary(cwd)
  if (remote) {
    const head = await run(cwd, ["symbolic-ref", `refs/remotes/${remote}/HEAD`])
    if (head.exitCode === 0) {
      const ref = out(head).replace(/^refs\/remotes\//, "")
      const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
      if (name) return { name, ref } satisfies Base
    }

    const next = await remoteHead(cwd, remote)
    if (next) return next
  }

  const list = await branches(cwd)
  for (const name of ["main", "master"]) {
    if (list.includes(name)) return { name, ref: name }
  }
}

async function head(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--verify", "HEAD"])
  return result.exitCode === 0
}

async function work(cwd: string, file: string) {
  const full = path.join(cwd, file)
  if (!(await Filesystem.exists(full))) return ""
  const buf = await Filesystem.readBytes(full).catch(() => Buffer.alloc(0))
  if (buf.includes(0)) return ""
  return buf.toString("utf8")
}

async function show(cwd: string, ref: string, file: string, base: string) {
  const target = base ? `${base}${file}` : file
  const result = await run(cwd, ["show", `${ref}:${target}`])
  if (result.exitCode !== 0) return ""
  return result.text()
}

function kind(code: string | undefined): "added" | "deleted" | "modified" {
  if (code?.startsWith("A")) return "added"
  if (code?.startsWith("D")) return "deleted"
  return "modified"
}

function count(text: string) {
  if (!text) return 0
  if (!text.endsWith("\n")) return text.split("\n").length
  return text.slice(0, -1).split("\n").length
}

async function track(cwd: string, ref: string) {
  const base = await prefix(cwd)
  const names = await run(cwd, ["diff", "--no-ext-diff", "--no-renames", "--name-status", ref, "--", "."])
  const nums = await run(cwd, ["diff", "--no-ext-diff", "--no-renames", "--numstat", ref, "--", "."])
  const map = new Map<string, "added" | "deleted" | "modified">()
  const list: Snapshot.FileDiff[] = []

  for (const line of out(names).split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!file) continue
    map.set(file, kind(code))
  }

  const rows = out(nums).split("\n").filter(Boolean)
  const next = await mapLimit(rows, 8, async (line) => {
    const [adds, dels, file] = line.split("\t")
    if (!file) return undefined
    const binary = adds === "-" && dels === "-"
    const status = map.get(file) ?? "modified"
    const before = binary || status === "added" ? "" : await show(cwd, ref, file, base)
    const after = binary || status === "deleted" ? "" : await work(cwd, file)
    const add = binary ? 0 : Number.parseInt(adds || "0", 10)
    const del = binary ? 0 : Number.parseInt(dels || "0", 10)
    return {
      file,
      before,
      after,
      additions: Number.isFinite(add) ? add : 0,
      deletions: Number.isFinite(del) ? del : 0,
      status,
    } satisfies Snapshot.FileDiff
  })
  for (const item of next) {
    if (item) list.push(item)
  }

  const extra = await run(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."])
  const added = await mapLimit(out(extra).split("\n").filter(Boolean), 16, async (file) => {
    if (map.has(file)) return undefined
    const after = await work(cwd, file)
    return {
      file,
      before: "",
      after,
      additions: count(after),
      deletions: 0,
      status: "added",
    } satisfies Snapshot.FileDiff
  })
  for (const item of added) {
    if (item) list.push(item)
  }

  return list.toSorted((a, b) => a.file.localeCompare(b.file))
}

async function birth(cwd: string) {
  const result = await run(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."])
  const list = await mapLimit(out(result).split("\n").filter(Boolean), 16, async (file) => {
    const after = await work(cwd, file)
    return {
      file,
      before: "",
      after,
      additions: count(after),
      deletions: 0,
      status: "added",
    } satisfies Snapshot.FileDiff
  })
  return list.toSorted((a, b) => a.file.localeCompare(b.file))
}

export namespace Vcs {
  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

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
      branch: z.string().optional(),
      default_branch: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>
}

export namespace VcsService {
  export interface Service {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly defaultBranch: () => Effect.Effect<string | undefined>
    readonly diff: (mode: Vcs.Mode) => Effect.Effect<Snapshot.FileDiff[]>
  }
}

export class VcsService extends ServiceMap.Service<VcsService, VcsService.Service>()("@opencode/Vcs") {
  static readonly layer = Layer.effect(
    VcsService,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let current: string | undefined
      let root: Base | undefined

      if (instance.project.vcs === "git") {
        const currentBranch = async () => {
          return branch(instance.directory)
        }

        ;[current, root] = yield* Effect.promise(() => Promise.all([currentBranch(), base(instance.directory)]))
        log.info("initialized", { branch: current, default_branch: root?.name })

        const unsubscribe = Bus.subscribe(
          FileWatcher.Event.Updated,
          Instance.bind(async (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            const next = await currentBranch()
            if (next !== current) {
              log.info("branch changed", { from: current, to: next })
              current = next
              Bus.publish(Vcs.Event.BranchUpdated, { branch: next })
            }
          }),
        )

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
      }

      return VcsService.of({
        init: Effect.fn("VcsService.init")(function* () {}),
        branch: Effect.fn("VcsService.branch")(function* () {
          return current
        }),
        defaultBranch: Effect.fn("VcsService.defaultBranch")(function* () {
          return root?.name
        }),
        diff: Effect.fn("VcsService.diff")(function* (mode: Vcs.Mode) {
          if (instance.project.vcs !== "git") return []
          if (mode === "git") {
            const ok = yield* Effect.promise(() => head(instance.directory))
            return yield* Effect.promise(() => (ok ? track(instance.directory, "HEAD") : birth(instance.directory)))
          }

          if (!root) return []
          if (current && current === root.name) return []
          const ref = yield* Effect.promise(() => run(instance.project.worktree, ["merge-base", root.ref, "HEAD"]))
          if (ref.exitCode !== 0) return []
          const text = out(ref)
          if (!text) return []
          return yield* Effect.promise(() => track(instance.directory, text))
        }),
      })
    }),
  )
}
