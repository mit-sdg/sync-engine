import { immediate, many } from "@mit-sdg/sync-engine-rendering/language";
import type { ImmediateBindings } from "../realization/realization.ts";

/** Stock immediates: declarations here, implementations in stockImmediates. */

export const ClearOnAccept = immediate("Empties its fields after this element's ask is accepted.", {
  on: "accepted",
  fields: many("field"),
});

export const RefocusOnRefusal = immediate(
  "Focuses its field after this element's ask is refused.",
  { on: "refused", field: "field" },
);

export const stockImmediates: ImmediateBindings = {
  ClearOnAccept: ({ fields }: { fields: { value: string }[] }) => {
    for (const field of fields) field.value = "";
  },
  RefocusOnRefusal: ({ field }: { field: { focus(): void } }) => {
    field.focus();
  },
};
