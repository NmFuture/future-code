interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opencode-server" {
  export namespace Server {
    export const listen: (opts: any) => Promise<any> // typeof import("../../../opencode/src/node").Server.listen
    export type Listener = any // import("../../../opencode/src/node").Server.Listener
  }
  export namespace Config {
    export const get: () => Promise<any> // typeof import("../../../opencode/src/node").Config.get
    export type Info = any // import("../../../opencode/src/node").Config.Info
  }
  export const bootstrap: <T>(path: string, cb: () => T) => Promise<T> // typeof import("../../../opencode/src/node").bootstrap
}
