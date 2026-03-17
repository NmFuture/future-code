import path from "path"
import { TRUNCATION_DIR } from "./truncation-dir"
import type { Agent } from "../agent/agent"
import { runtime } from "@/effect/runtime"
import * as S from "./truncate-service"


export namespace Truncate {
  export const MAX_LINES = S.MAX_LINES
  export const MAX_BYTES = S.MAX_BYTES
  export const DIR = TRUNCATION_DIR
  export const GLOB = path.join(TRUNCATION_DIR, "*")

  export type Result = S.Result

  export type Options = S.Options

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    return runtime.runPromise(S.TruncateService.use((s) => s.output(text, options, agent)))
  }
}
