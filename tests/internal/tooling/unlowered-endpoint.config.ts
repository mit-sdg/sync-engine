import { assemble } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/internal/boundary";
import { Frames, request, vocabulary } from "@sync-engine/internal/reactions";

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
    .then(request(Sessioning.current, { session: "fixed" }, { user }))
    .then(respond({ hidden })),
);

export default {
  assemble: () => assemble({ vocabulary: declared, composition: { Api: { ClosureEndpoint } } }),
  title: "Incomplete application",
  vocabulary: { module: new URL("../../../src/language/index.ts", import.meta.url) },
};
