import { assemble } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { Frames } from "@sync-engine/internal/reads/frames";
import { vocabularyDeclaration, Sessioning } from "./fixtures/generated-artifacts/vocabulary.ts";

const ClosureEndpoint = endpoint("/closure", ({ hidden, user }) =>
  receive({})
    .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "kept" })))
    .then(Sessioning.current({ session: "fixed" }).responds({ user }))
    .then(respond({ hidden })),
);

export default {
  assemble: () =>
    assemble({ vocabulary: vocabularyDeclaration, composition: { Api: { ClosureEndpoint } } }),
  title: "Incomplete application",
  design: {
    version: 1,
    documents: [new URL("./fixtures/generated-artifacts/api-closure.md", import.meta.url)],
  },
  conceptSet: {
    module: new URL("./fixtures/generated-artifacts/vocabulary.ts", import.meta.url),
  },
};
