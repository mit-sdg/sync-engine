import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  FileNotFound,
  FilingConcept,
  InvalidEncoding,
  InvalidPath,
  InvalidSource,
  PathLeavesRoot,
  RootNotFound,
} from "./filing.ts";
import spec from "./spec.md" with { type: "text" };

export const filing = registerConcept({
  class: FilingConcept,
  spec,
  refusals: {
    INVALID_SOURCE: InvalidSource,
    PATH_LEAVES_ROOT: PathLeavesRoot,
    INVALID_PATH: InvalidPath,
    ROOT_NOT_FOUND: RootNotFound,
    INVALID_ENCODING: InvalidEncoding,
    FILE_NOT_FOUND: FileNotFound,
  },
});
