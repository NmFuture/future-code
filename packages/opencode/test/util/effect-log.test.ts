import { beforeEach, expect, mock, test } from "bun:test"
import { Cause, Effect } from "effect"
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References"

const debug = mock(() => {})
const info = mock(() => {})
const warn = mock(() => {})
const error = mock(() => {})
const create = mock(() => ({
  debug,
  info,
  warn,
  error,
  tag() {
    return this
  },
  clone() {
    return this
  },
  time() {
    return {
      stop() {},
      [Symbol.dispose]() {},
    }
  },
}))

mock.module("../../src/util/log", () => ({
  Log: {
    create,
  },
}))

const EffectLog = await import("../../src/util/effect-log")

beforeEach(() => {
  create.mockClear()
  debug.mockClear()
  info.mockClear()
  warn.mockClear()
  error.mockClear()
})

test("EffectLog.layer routes info logs through util/log", async () => {
  await Effect.runPromise(Effect.logInfo("hello").pipe(Effect.provide(EffectLog.layer({ service: "effect-test" }))))

  expect(create).toHaveBeenCalledWith({ service: "effect-test" })
  expect(info).toHaveBeenCalledWith("hello", expect.any(Object))
})

test("EffectLog.layer forwards annotations and spans to util/log", async () => {
  await Effect.runPromise(
    Effect.logInfo("hello").pipe(
      Effect.annotateLogs({ requestId: "req-123" }),
      Effect.withLogSpan("provider-auth"),
      Effect.provide(EffectLog.layer({ service: "effect-test-meta" })),
    ),
  )

  expect(info).toHaveBeenCalledWith(
    "hello",
    expect.objectContaining({
      requestId: "req-123",
      spans: expect.arrayContaining([
        expect.objectContaining({
          label: "provider-auth",
        }),
      ]),
    }),
  )
})

test("EffectLog.make formats structured messages and causes for legacy logger", () => {
  const logger = EffectLog.make({ service: "effect-test-struct" })

  logger.log({
    message: { hello: "world" },
    logLevel: "Warn",
    cause: Cause.fail(new Error("boom")),
    fiber: {
      id: 123n,
      getRef(ref: unknown) {
        if (ref === CurrentLogAnnotations) return {}
        if (ref === CurrentLogSpans) return []
        return undefined
      },
    },
    date: new Date(),
  } as never)

  expect(warn).toHaveBeenCalledWith(
    '{"hello":"world"}',
    expect.objectContaining({
      fiber: 123n,
    }),
  )
})
