interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opencode-server" {
  export namespace Server {
    export const listen: typeof import("../../../opencode/dist/types/node").Server.listen
    export type Listener = import("../../../opencode/dist/types/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../opencode/dist/types/node").Config.get
    export type Info = import("../../../opencode/dist/types/node").Config.Info
  }
  export const bootstrap: typeof import("../../../opencode/dist/types/node").bootstrap
}
