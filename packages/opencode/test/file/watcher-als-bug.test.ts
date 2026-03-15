/**
 * Repro for: @parcel/watcher native callback loses AsyncLocalStorage context
 *
 * Background:
 *   opencode uses AsyncLocalStorage (ALS) to track which project directory
 *   is active. Bus.publish reads Instance.directory from ALS to route events
 *   to the right instance. This works for normal JS async code (setTimeout,
 *   Promises, etc.) because Node propagates ALS through those.
 *
 *   But @parcel/watcher is a native C++ addon. Its callback re-enters JS
 *   from C++ via libuv, bypassing Node's async hooks — so ALS is empty.
 *   Bus.publish silently throws Context.NotFound, and the event vanishes.
 *
 * What this breaks:
 *   The git HEAD watcher (always active, no experimental flag) should detect
 *   branch switches and update the TUI. But because events never arrive,
 *   the branch indicator never live-updates.
 *
 * This test:
 *   1. Creates a tmp git repo and boots an instance with the file watcher
 *   2. Listens on GlobalBus for watcher events (Bus.publish emits to GlobalBus)
 *   3. Runs `git checkout -b` to change .git/HEAD — the watcher WILL detect
 *      this change and fire the callback, but Bus.publish will fail silently
 *   4. Times out after 5s because the event never reaches GlobalBus
 *
 * Fix: Instance.bind(fn) captures ALS context at subscription time and
 * restores it in the callback. See #17601.
 */
import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

async function load() {
  const { FileWatcher } = await import("../../src/file/watcher")
  const { GlobalBus } = await import("../../src/bus/global")
  const { Instance } = await import("../../src/project/instance")
  return { FileWatcher, GlobalBus, Instance }
}

afterEach(async () => {
  const { Instance } = await load()
  await Instance.disposeAll()
})

test("git HEAD watcher publishes events via Bus (ALS context test)", async () => {
  const { FileWatcher, GlobalBus, Instance } = await load()

  // 1. Create a temp git repo and start the file watcher inside an instance.
  //    The watcher subscribes to .git/HEAD changes via @parcel/watcher.
  //    At this point we're inside Instance.provide, so ALS is active.
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      FileWatcher.init()
      await Bun.sleep(200) // wait for native watcher to finish subscribing
    },
  })

  // 2. Listen on GlobalBus and trigger a branch switch.
  //    When .git/HEAD changes, @parcel/watcher fires our callback from C++.
  //    The callback calls Bus.publish, which needs ALS to read Instance.directory.
  //    Without Instance.bind, ALS is empty → Bus.publish throws → event never arrives.
  const got = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error("timed out — native callback likely lost ALS context"))
    }, 5000)

    function on(evt: any) {
      if (evt.directory !== tmp.path) return
      if (evt.payload?.type !== FileWatcher.Event.Updated.type) return
      clearTimeout(timeout)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties)
    }

    GlobalBus.on("event", on)

    // This changes .git/HEAD, which the native watcher will detect
    $`git checkout -b test-branch`.cwd(tmp.path).quiet().nothrow()
  })

  // 3. If we get here, the event arrived — ALS context was preserved.
  //    On the unfixed code, we never get here (the promise rejects with timeout).
  expect(got).toBeDefined()
  expect(got.event).toBe("change")
})
