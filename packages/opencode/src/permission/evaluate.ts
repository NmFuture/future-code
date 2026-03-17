import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import type { Rule, Ruleset } from "./service"

const log = Log.create({ service: "permission" })

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const rules = rulesets.flat()
  log.info("evaluate", { permission, pattern, ruleset: rules })
  const match = rules.findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern))
  return match ?? { action: "ask", permission, pattern: "*" }
}
