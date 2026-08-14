import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

const { Discussing, Selecting } = concepts;

// An empty input pattern ({}) matches any choose regardless of scope or item.
const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);

export const composition = { SelectedMitigationOpensDiscussion };
