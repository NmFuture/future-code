# Effect migration

Practical path for adopting Effect in opencode.

## Aim

Move `packages/opencode` toward Effect one domain at a time. Treat the migration as successful when the core path for a domain is Effect-based, even if temporary promise wrappers still exist at the edges.

---

## Decide

Use these defaults unless a domain gives us a good reason not to.

- Migrate one module or domain at a time
- Preserve compatibility mainly at boundaries, not throughout internals
- Prefer adapter-layer-first work for mutable or request-scoped systems
- Treat CLI, server, and jobs as runtime boundaries
- Use the shared managed runtime only as a bridge during migration

This keeps the work incremental and lets us remove compatibility code later instead of freezing it into every layer.

---

## Slice work

Pick migration units that can own a clear service boundary and a small runtime story.

Good early candidates:

- CRUD-like domains with stable storage and HTTP boundaries
- Modules that already have a natural service shape
- Areas where a promise facade can stay temporarily at the public edge

Harder candidates:

- `Instance`-like systems with async local state
- Request-scoped mutable state
- Modules that implicitly depend on ambient context or lifecycle ordering

---

## Start at boundaries

Begin by extracting an Effect service behind the existing module boundary. Keep old call sites working by adding a thin promise facade only where needed.

Current example:

- `packages/opencode/src/account/service.ts` holds the Effect-native service
- `packages/opencode/src/account/index.ts` keeps a promise-facing facade
- `packages/opencode/src/cli/cmd/account.ts` already uses `AccountService` directly
- `packages/opencode/src/config/config.ts` and `packages/opencode/src/share/share-next.ts` still use the facade

This is the preferred first move for most domains.

---

## Bridge runtime

Use a shared app runtime only to help mixed code coexist while we migrate. Do not treat it as the final architecture by default.

Current bridge:

- `packages/opencode/src/effect/runtime.ts`

Near-term rule:

- Effect-native entrypoints can run effects directly
- Legacy promise namespaces can call into the shared runtime
- New domains should not depend on broad global runtime access unless they are explicitly boundary adapters

As more boundaries become Effect-native, the shared runtime should shrink instead of becoming more central.

---

## Handle state

Treat async local state and mutable contextual systems as adapter problems first. Do not force `Instance`-style behavior directly into pure domain services on the first pass.

Recommended approach:

- Keep current mutable/contextual machinery behind a small adapter
- Expose a narrower Effect service above that adapter
- Move ambient reads and writes to the edge of the module
- Delay deeper context redesign until the boundary is stable

For `Instance`-like code, the first win is usually isolating state access, not eliminating it.

---

## Wrap `Instance`

Keep `Instance` backed by AsyncLocalStorage for now. Do not force a full ALS replacement before we have a clearer service boundary.

- Add an Effect-facing interface over the current ALS-backed implementation first
- Point new Effect code at that interface
- Let untouched legacy code keep using raw `Instance`

We may split mutable state from read-only context as the design settles. If that happens, state can migrate on its own path and then depend on the Effect-facing context version instead of raw ALS directly.

**Instance.state** - Most modules use `Instance.state()` for scoped mutable state, so we should not try to replace `Instance` itself too early. Start by wrapping it in an adapter and exposing an Effect service above the current machinery. Over time, state should move onto an Effectful abstraction of our own, with `ScopedCache` as the most likely fit for per-instance state that needs keyed lookup and cleanup. It can stay scoped by the current instance key during transition, usually the directory today, while domains can still add finer keys like `SessionID` inside their own state where needed.

This keeps the first step small, lowers risk, and avoids redesigning request context too early.

---

## Shape APIs

Prefer an Effect-first core and a compatibility shell at the edge.

Guidance:

- Name the service after the domain, like `AccountService`
- Keep methods small and domain-shaped, not transport-shaped
- Return `Effect` from the core service
- Use promise helpers only in legacy namespaces or boundary adapters
- Keep error types explicit when the domain already has stable error shapes

Small pattern:

```ts
export class FooService extends ServiceMap.Service<FooService, FooService.Service>()("@opencode/Foo") {
  static readonly layer = Layer.effect(
    FooService,
    Effect.gen(function* () {
      return FooService.of({
        get: Effect.fn("FooService.get")(function* (id: FooID) {
          return yield* ...
        }),
      })
    }),
  )
}
```

Temporary facade pattern:

```ts
function runPromise<A>(f: (service: FooService.Service) => Effect.Effect<A, FooError>) {
  return runtime.runPromise(FooService.use(f))
}

export namespace Foo {
  export function get(id: FooID) {
    return runPromise((service) => service.get(id))
  }
}
```

---

## Use Repo carefully

A `Repo` layer is often useful, but it should stay a tool, not a rule.

Tradeoffs:

- `Repo` helps when storage concerns are real and reusable
- `Repo` can clarify error mapping and persistence boundaries
- `Repo` can also add ceremony for thin modules or one-step workflows

Current leaning:

- Use a `Repo` when it simplifies storage-heavy domains
- Skip it when a direct service implementation stays clearer
- Revisit consistency after a few more migrations, not before

`packages/opencode/src/account/repo.ts` is a reasonable pattern for storage-backed domains, but it should not become mandatory yet.

---

## Test safely

Keep tests stable while internals move. Prefer preserving current test surfaces until a domain has fully crossed its main boundary.

Practical guidance:

- Keep existing promise-based tests passing first
- Add focused tests for new service behavior where it reduces risk
- Move boundary tests later, after the internal service shape settles
- Avoid rewriting test helpers and runtime wiring in the same PR as a domain extraction

This lowers risk and makes the migration easier to review.

---

## Roll out

Use a phased roadmap.

### Phase 0

Set conventions and prove the boundary pattern.

- Keep `account` as the reference example, but not the template for every case
- Document the temporary runtime bridge and when to use it
- Prefer one or two more CRUD-like domains next

### Phase 1

Migrate easy and medium domains one at a time.

- Extract service
- Keep boundary facade if needed
- Convert one runtime entrypoint to direct Effect use
- Collapse internal promise plumbing inside the domain

### Phase 2

Tackle context-heavy systems with adapters first.

- Isolate async local state behind Effect-facing adapters
- Move lifecycle and mutable state reads to runtime edges
- Convert core domain logic before trying to redesign shared context

### Phase 3

Reduce bridges and compatibility surfaces.

- Remove facades that no longer serve external callers
- Narrow the shared runtime bridge
- Standardize remaining service and error shapes where it now feels earned

---

## Check progress

Use these signals to judge whether a domain is really migrated.

A domain is in good shape when:

- Its core logic runs through an Effect service
- Internal callers prefer the Effect API
- Compatibility wrappers exist only at real boundaries
- CLI, server, or job entrypoints can run the Effect path directly
- The shared runtime is only a temporary connector, not the center of the design

A domain is not done just because it has an Effect service somewhere in the stack.

---

## Candidate ranking

Ranked by feasibility and payoff. Account is already migrated and serves as the reference.

### Tier 1 — Easy wins

| #   | Module         | Lines | Shape                                  | Why                                                                                                |
| --- | -------------- | ----- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | **Auth**       | 74    | File CRUD (get/set/remove)             | Zero ambient state, zero deps besides Filesystem. Trivial win to prove the pattern beyond account. |
| 2   | **Question**   | 168   | ask/reply/reject + Instance.state Map  | Clean service boundary, single pending Map. Nearly identical to Permission but simpler.            |
| 3   | **Permission** | 210   | ask/respond/list + session-scoped Maps | Pending + approved Maps, already uses branded IDs. Session-scoped state maps to Effect context.    |
| 4   | **Scheduler**  | 62    | register/unregister tasks with timers  | `Effect.repeat` / `Effect.schedule` is a natural fit. Tiny surface area.                           |

### Tier 2 — Medium complexity, high payoff

| #   | Module           | Lines | Shape                                           | Why                                                                                                       |
| --- | ---------------- | ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 5   | **Pty**          | 318   | Session lifecycle (create/remove/resize/write)  | Process + subscriber cleanup maps to `Effect.acquireRelease`. Buffer/subscriber state is instance-scoped. |
| 6   | **Bus**          | 106   | Pub/sub with instance-scoped subscriptions      | Fiber-based subscription cleanup would eliminate manual `off()` patterns throughout the codebase.         |
| 7   | **Snapshot**     | 417   | Git snapshot/patch/restore                      | Heavy subprocess I/O. Effect error handling and retry would help. No ambient state.                       |
| 8   | **Worktree**     | 673   | Git worktree create/remove/reset                | Stateless, all subprocess-based. Good `Effect.fn` candidate but larger surface.                           |
| 9   | **Installation** | 304   | Version check + upgrade across package managers | Multiple fallback paths (npm/brew/choco/scoop). Effect's error channel shines here.                       |

### Tier 3 — Harder, migrate after patterns are settled

| #   | Module   | Lines | Shape                                           | Why                                                                                                                 |
| --- | -------- | ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 10  | **File** | 655   | File ops with cache state                       | Background fetch side-effects would benefit from Fiber management. Mutable cache (files/dirs Maps) adds complexity. |
| 11  | **LSP**  | 487   | Client lifecycle: spawning → connected → broken | Effect resource management fits, but multi-state transitions are tricky.                                            |
| 12  | **MCP**  | 981   | Client lifecycle + OAuth flows                  | Largest single module. OAuth state spans multiple functions (startAuth → finishAuth). High payoff but highest risk. |

### Avoid early

These are too large, too foundational, or too pervasive to migrate without significant prior experience:

- **Provider** (~1400 lines) — provider-specific branching, AI SDK abstractions, complex model selection
- **Session** (~900 lines) — complex relational queries, branching logic, many dependents
- **Config** — pervasive dependency across codebase, complex precedence rules
- **Project / Instance** — foundational bootstrap, async local state, everything depends on it

### Patterns to watch for

**Instance.state** — Most modules use `Instance.state()` for scoped mutable state. Don't try to replace Instance itself early; wrap it in an adapter that exposes an Effect service above the existing machinery.

**Bus.subscribe + manual off()** — Pervasive throughout the codebase. Migrating Bus (candidate #6) unlocks Fiber-based cleanup everywhere, but it's infrastructure, not a domain win. Consider it after a few domain migrations prove the pattern.

**Database.use / Database.transaction** — Already resembles Effect context (provide/use pattern). Could become an Effect Layer, but this is infrastructure work best deferred until multiple domains are Effect-native.

**Process subprocess patterns** — Snapshot, Worktree, Installation all shell out to git or package managers. These are natural `Effect.tryPromise` / `Effect.fn` targets with error mapping.

---

## Effect modules to use

Effect already provides battle-tested replacements for several homegrown patterns. Prefer these over custom code as domains migrate.

### PubSub → replaces Bus

`PubSub` provides bounded/unbounded pub/sub with backpressure strategies. Subscriptions are scoped — cleanup is automatic when the subscriber's Scope closes, eliminating every manual `off()` call.

```ts
const pubsub = yield * PubSub.unbounded<Event>()
yield * PubSub.publish(pubsub, event)
// subscriber — automatically cleaned up when scope ends
const dequeue = yield * PubSub.subscribe(pubsub)
const event = yield * Queue.take(dequeue)
```

Don't migrate Bus first. Migrate domain modules, then swap Bus once there are enough Effect-native consumers.

### Schedule → replaces Scheduler

The custom 62-line Scheduler reinvents `Effect.repeat`. Effect's `Schedule` is composable and supports spaced intervals, exponential backoff, cron expressions, and more.

```ts
yield * effect.pipe(Effect.repeat(Schedule.spaced("30 seconds")))
```

### SubscriptionRef → replaces state + Bus.publish on mutation

Several modules follow the pattern: mutate `Instance.state`, then `Bus.publish` to notify listeners. `SubscriptionRef` is a `Ref` that emits changes as a `Stream`, combining both in one primitive.

```ts
const ref = yield * SubscriptionRef.make(initialState)
// writer
yield * SubscriptionRef.update(ref, (s) => ({ ...s, count: s.count + 1 }))
// reader — stream of every state change
yield * SubscriptionRef.changes(ref).pipe(Stream.runForEach(handleUpdate))
```

### Ref / SynchronizedRef → replaces Instance.state Maps

`Ref<A>` provides atomic read/write/update for concurrent-safe state. `SynchronizedRef` adds mutual exclusion for complex multi-step updates. Use these inside Effect services instead of raw mutable Maps.

### Scope + acquireRelease → replaces manual resource cleanup

Pty sessions, LSP clients, and MCP clients all have manual try/finally cleanup. `Effect.acquireRelease` ties resource lifecycle to Scope, making cleanup declarative and leak-proof.

```ts
const pty = yield * Effect.acquireRelease(createPty(options), (session) => destroyPty(session))
```

### ChildProcess → replaces shell-outs

Effect's `ChildProcess` provides type-safe subprocess execution with template literals and stream-based stdout/stderr. Useful for Snapshot, Worktree, and Installation modules.

```ts
const result = yield * ChildProcess.make`git diff --stat`.pipe(ChildProcess.spawn, ChildProcess.string)
```

Note: in `effect/unstable/process` — API may shift.

### FileSystem → replaces custom Filesystem utils

Cross-platform file I/O with stream support. Available via `effect/FileSystem` with a `NodeFileSystem` layer.

### KeyValueStore → replaces file-based Auth JSON

Abstracted key-value storage with file, memory, and browser backends. Auth's 74-line file CRUD could become a one-liner with `KeyValueStore`.

Available via `effect/unstable/persistence` — API may shift.

### HttpClient → replaces custom fetch calls

Full HTTP client with typed errors, request builders, and platform-aware layers. Useful when migrating Share and ControlPlane modules.

Available via `effect/unstable/http` — API may shift.

### HttpApi → replaces Hono

Effect's `HttpApi` provides schema-driven HTTP APIs with OpenAPI generation, type-safe routing, and middleware. Long-term candidate to replace the Hono server layer entirely. This is a larger lift — defer until multiple domain services are Effect-native and the boundary pattern is well-proven.

Available via `effect/unstable/httpapi` — API may shift.

### Schema → replaces Zod (partially)

Effect's `Schema` provides encoding/decoding, validation, and type derivation deeply integrated with Effect. Internal code can migrate to Schema as domains move to Effect services. However, the plugin API (`@opencode-ai/plugin`) uses Zod and must continue to accept Zod schemas at the boundary. Keep Zod-to-Schema bridges at plugin/SDK edges.

### Cache → replaces manual caching

The File module maintains mutable Maps (files/dirs) with a fetching flag for deduplication. `Cache` provides memoization with TTL and automatic deduplication, replacing this pattern.

### Pool → for resource-heavy clients

LSP client management (spawning/connected/broken state machine) could benefit from `Pool` for automatic acquisition, health checking, and release.

---

## Follow next

Recommended medium-term order:

1. Continue with CRUD-like or storage-backed modules
2. Convert boundary entrypoints in CLI, server, and jobs as services become available
3. Move into `Instance`-adjacent systems with adapter layers, not direct rewrites
4. Remove promise facades after direct callers have moved

This keeps momentum while reserving the hardest context work for when the team has a clearer house style.
