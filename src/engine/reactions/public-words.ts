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

/** Watch the posture stated by one callable vocabulary action line. */
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
