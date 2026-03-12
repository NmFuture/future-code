import { Effect } from "effect"
import { runtime } from "@/effect/runtime"
import {
  Api as ApiSchema,
  AuthService,
  type AuthServiceError,
  Info as InfoSchema,
  Oauth as OauthSchema,
  WellKnown as WellKnownSchema,
  type Info as AuthInfo,
} from "./service"

export { OAUTH_DUMMY_KEY } from "./service"

function runPromise<A>(f: (service: AuthService.Service) => Effect.Effect<A, AuthServiceError>) {
  return runtime.runPromise(AuthService.use(f))
}

export namespace Auth {
  export const Oauth = OauthSchema
  export const Api = ApiSchema
  export const WellKnown = WellKnownSchema
  export const Info = InfoSchema
  export type Info = AuthInfo

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }
}
