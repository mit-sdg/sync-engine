import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { NotifyingConcept, NotificationNotFound } from "./notifying.ts";
import spec from "./spec.md" with { type: "text" };

export const notifying = registerConcept({
  class: NotifyingConcept,
  spec,
  refusals: { NOTIFICATION_NOT_FOUND: NotificationNotFound },
});
