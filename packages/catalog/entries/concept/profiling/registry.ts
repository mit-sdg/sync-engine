import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  ProfilingConcept,
  DisplayNameRequired,
  ProfileAlreadyExists,
  ProfileNotFound,
} from "./profiling.ts";
import spec from "./spec.md" with { type: "text" };

export const profiling = registerConcept({
  class: ProfilingConcept,
  spec,
  refusals: {
    DISPLAY_NAME_REQUIRED: DisplayNameRequired,
    PROFILE_ALREADY_EXISTS: ProfileAlreadyExists,
    PROFILE_NOT_FOUND: ProfileNotFound,
  },
});
