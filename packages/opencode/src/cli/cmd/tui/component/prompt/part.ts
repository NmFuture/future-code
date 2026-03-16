import { PartID } from "@/session/schema"

export function strip<T extends { id?: string; messageID?: string; sessionID?: string }>(part: T) {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

export function assign<T extends object>(part: T) {
  return {
    ...part,
    id: PartID.ascending(),
  }
}
