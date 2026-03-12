import path from "path"
import { Effect, Layer, Schema, ServiceMap } from "effect"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export const Oauth = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .meta({ ref: "OAuth" })

export const Api = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })

export const WellKnown = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
export type Info = z.infer<typeof Info>

export class AuthServiceError extends Schema.TaggedErrorClass<AuthServiceError>()("AuthServiceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthServiceError({ message, cause })

export namespace AuthService {
  export interface Service {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthServiceError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthServiceError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthServiceError>
    readonly remove: (key: string) => Effect.Effect<void, AuthServiceError>
  }
}

export class AuthService extends ServiceMap.Service<AuthService, AuthService.Service>()("@opencode/Auth") {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const all = Effect.fn("AuthService.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}))
            return Object.entries(data).reduce(
              (acc, [key, value]) => {
                const parsed = Info.safeParse(value)
                if (!parsed.success) return acc
                acc[key] = parsed.data
                return acc
              },
              {} as Record<string, Info>,
            )
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const get = Effect.fn("AuthService.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("AuthService.set")(function* (key: string, info: Info) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, { ...data, [norm]: info }, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      const remove = Effect.fn("AuthService.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, data, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      return AuthService.of({
        get,
        all,
        set,
        remove,
      })
    }),
  )

  static readonly defaultLayer = AuthService.layer
}
