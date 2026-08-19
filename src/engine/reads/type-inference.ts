/** Type-only helpers for exact authored input and output patterns. */

import type { FusedFormer } from "./former-nodes.ts";

/** One pattern slot is either the slot's literal value or one logic variable. */
export type PatternValue<Value> = Value | symbol | FusedFormer;

export type InputPattern<Input extends object> = {
  readonly [Key in keyof Input]: PatternValue<Input[Key]>;
};

export type PartialPattern<Shape> = {
  readonly [Key in keyof Shape]?: PatternValue<Shape[Key]>;
};

type ExactObject<Shape extends object, Pattern extends object> = Pattern &
  Record<Exclude<keyof Pattern, keyof Shape>, never> & {
    [Key in keyof Pattern & keyof Shape]: ExactValue<NonNullable<Shape[Key]>, Pattern[Key]>;
  };

type ExactValue<Shape, Pattern> = Shape extends unknown
  ? Pattern extends symbol
    ? Pattern
    : Shape extends readonly (infer ShapeItem)[]
      ? Pattern extends readonly (infer PatternItem)[]
        ? Pattern & readonly ExactValue<ShapeItem, PatternItem>[]
        : Pattern
      : Shape extends object
        ? Pattern extends object
          ? ExactObject<Shape, Pattern>
          : Pattern
        : Pattern
  : never;

export type ExactPattern<Shape, Pattern> = ExactValue<Shape, Pattern>;
