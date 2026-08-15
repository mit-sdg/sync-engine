import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  CommandingConcept,
  ExitSelected,
  InvalidArguments,
  InvalidExitCode,
  InvalidStream,
  InvalidText,
  InvocationCaptured,
} from "./commanding.ts";
import spec from "./spec.md" with { type: "text" };

export const commanding = registerConcept({
  class: CommandingConcept,
  spec,
  refusals: {
    INVALID_ARGUMENTS: InvalidArguments,
    INVOCATION_CAPTURED: InvocationCaptured,
    INVALID_STREAM: InvalidStream,
    INVALID_TEXT: InvalidText,
    INVALID_EXIT_CODE: InvalidExitCode,
    EXIT_SELECTED: ExitSelected,
  },
});
