/**
 * Public-facing `when` — narrows the internal overloads in `words.ts` to the
 * author-facing union (concrete action lines and channel patterns only,
 * excluding internal `StepNode`). The internal `words.ts` accepts a wider
 * signature for lowered reaction reconstruction.
 */
import { when as authoredWhen } from "./words.ts";
import type {
  ActionCall,
  ChannelPattern,
  RefusedActionLine,
  RefusedTriggerActionLine,
  ReturnedActionLine,
  ReturnedTriggerActionLine,
  TriggerActionLine,
  WhenBuilder,
} from "./types.ts";

export const when = authoredWhen as (
  line:
    | ChannelPattern
    | ActionCall
    | TriggerActionLine
    | ReturnedActionLine
    | ReturnedTriggerActionLine
    | RefusedActionLine
    | RefusedTriggerActionLine,
) => WhenBuilder;
