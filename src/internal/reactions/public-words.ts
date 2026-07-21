import { when as authoredWhen } from "./words.ts";
import type {
  ActionCall,
  RefusedActionLine,
  RefusedTriggerActionLine,
  ReturnedActionLine,
  ReturnedTriggerActionLine,
  TriggerActionLine,
  WhenBuilder,
} from "./types.ts";

/** Watch the posture stated by one callable vocabulary action line. */
export const when = authoredWhen as (
  line:
    | ActionCall
    | TriggerActionLine
    | ReturnedActionLine
    | ReturnedTriggerActionLine
    | RefusedActionLine
    | RefusedTriggerActionLine,
) => WhenBuilder;
