// Mirrors shared/schemas/event.schema.json. Change both together.

export type EventType = "checkin" | "hazard" | "case" | "missing_person";

export interface HollowEvent {
  id: string;
  type: EventType;
  hub_id: string;
  level: number;
  created_at: string;
  author: string;
  priority: number | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export type NewEvent = Pick<HollowEvent, "type" | "level" | "author" | "payload"> & {
  priority?: number | null;
};
