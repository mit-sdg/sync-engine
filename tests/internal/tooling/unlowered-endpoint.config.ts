import { assemble } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/language";
import { Frames } from "@sync-engine/internal/reads/frames";

class SessioningConcept {
  current({ session }: { session: string }) {
    return { user: session };
  }
}

const declared = vocabulary({ concepts: { Sessioning: SessioningConcept }, computations: {} });
const { Sessioning } = declared.concepts;

const ClosureEndpoint = endpoint("/closure", ({ hidden, user }) =>
  receive({})
    .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "kept" })))
    .then(Sessioning.current({ session: "fixed" }).responds({ user }))
    .then(respond({ hidden })),
);

export default {
  assemble: () => assemble({ vocabulary: declared, composition: { Api: { ClosureEndpoint } } }),
  title: "Incomplete application",
  design: { version: 1, documents: [] },
  conceptSet: { module: new URL("../../../src/language/index.ts", import.meta.url) },
};
