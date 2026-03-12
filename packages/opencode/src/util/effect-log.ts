import { Cause, Logger } from "effect"
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References"

import { Log } from "./log"

function text(input: unknown): string {
  if (Array.isArray(input)) return input.map(text).join(" ")
  if (input instanceof Error) return input.message
  if (typeof input === "string") return input
  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(input)
    } catch {
      return String(input)
    }
  }
  return String(input)
}

export function make(tags?: Record<string, unknown>) {
  const log = Log.create(tags)

  return Logger.make<unknown, void>((options) => {
    const annotations = options.fiber.getRef(CurrentLogAnnotations as never) as Readonly<Record<string, unknown>>
    const spans = options.fiber.getRef(CurrentLogSpans as never) as ReadonlyArray<readonly [string, number]>
    const extra = {
      ...annotations,
      fiber: options.fiber.id,
      spans: spans.length
        ? spans.map(([label, start]) => ({
            label,
            duration: options.date.getTime() - start,
          }))
        : undefined,
      cause: options.cause.reasons.length ? Cause.pretty(options.cause) : undefined,
    }

    if (options.logLevel === "Debug" || options.logLevel === "Trace") {
      return log.debug(text(options.message), extra)
    }

    if (options.logLevel === "Info") {
      return log.info(text(options.message), extra)
    }

    if (options.logLevel === "Warn") {
      return log.warn(text(options.message), extra)
    }

    return log.error(text(options.message), extra)
  })
}

export function layer(tags?: Record<string, unknown>, options?: { mergeWithExisting?: boolean }) {
  return Logger.layer([make(tags)], options)
}
