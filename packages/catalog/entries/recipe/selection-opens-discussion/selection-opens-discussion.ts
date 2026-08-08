import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Discussing, Selecting } = concepts;

/** Give every new selection its own discussion. */
export const SelectionOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
