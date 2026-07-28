import { describe, expect, test } from "vite-plus/test";
import { custom } from "@sync-engine/advanced";
import { assemble } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { each, former, reaction, view, vocabulary, when, where } from "@sync-engine/language";
import type { Vars } from "@sync-engine/language";
import {
  applicationDependencyGraph,
  applicationImpact,
  applicationManifest,
  inspectAssembly,
  planGenerated,
  renderApplicationManifest,
} from "@sync-engine/tooling";
import { Frames } from "@sync-engine/internal/reads/frames";
import { oneOf } from "@sync-engine/internal/reads/matchers";

class WorkingConcept {
  static readonly queries = { _items: "many" } as const;
  readonly recorded: string[] = [];

  start({ value = "started" }: { value?: string }) {
    return { value };
  }

  record({ value }: { value: string }) {
    this.recorded.push(value);
    return {};
  }

  _items(_: Record<string, never>) {
    return [{ value: "one" }, { value: "two" }];
  }
}

const words = vocabulary({ concepts: { Working: WorkingConcept }, computations: {} });
const { Working } = words.concepts;

const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));

describe("request-boundary locality", () => {
  test("rejects direct closure and custom endpoint behavior without an override", () => {
    const ClosureEndpoint = endpoint("/closure", () =>
      receive()
        .where((frames: Frames) => frames)
        .then(respond({ unreachable: true })),
    );
    const CustomEndpoint = endpoint("/custom", () =>
      receive()
        .where(custom(() => true, [], []))
        .then(respond({ unreachable: true })),
    );

    for (const [name, definition] of [
      ["ClosureEndpoint", ClosureEndpoint],
      ["CustomEndpoint", CustomEndpoint],
    ] as const) {
      expect(() =>
        assemble({
          vocabulary: words,
          composition: { [name]: definition },
          localBehavior: {
            revision: "attempted-override",
            definitions: [{ kind: "reaction", name }],
          },
        }),
      ).toThrow(
        /local behavior cannot participate in request-boundary behavior.*no endpoint override/s,
      );
    }
  });

  test("rejects endpoint object-identity patterns", () => {
    class Identity {}
    const identity = new Identity();
    const IdentityEndpoint = endpoint("/identity", () =>
      receive({ identity }).then(respond({ unreachable: true })),
    );

    expect(() => assemble({ vocabulary: words, composition: { IdentityEndpoint } })).toThrow(
      /IdentityEndpoint.*object-identity pattern "literal Identity"/s,
    );
  });

  test("rejects opaque views and formers reached transitively from endpoints", () => {
    const localView = view("(value) passes local code", ({ value }) =>
      where(custom(() => true, [value], [])),
    ).holds();
    const ViewEndpoint = endpoint("/view", ({ value }) =>
      receive({ value })
        .where(localView({ value }))
        .then(respond({ ok: true })),
    );
    expect(() => assemble({ vocabulary: words, composition: { localView, ViewEndpoint } })).toThrow(
      /ViewEndpoint.*local view "\(value\) passes local code"/s,
    );

    const localFormer = former("the local items", (_inputs, { value }) =>
      each(Working._items({}).is({ value }))
        .where(custom(() => true, [value], []))
        .form({ value }),
    );
    const FormerEndpoint = endpoint("/former", () =>
      receive().then(respond({ items: localFormer({}) })),
    );
    expect(() =>
      assemble({ vocabulary: words, composition: { localFormer, FormerEndpoint } }),
    ).toThrow(/FormerEndpoint.*local former "the local items"/s);
  });

  test("rejects an unlowered ordinary reaction that touches RequestBoundary", () => {
    const GlobalBoundary = reaction(({ hidden, value }: Vars) =>
      receive()
        .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "local" })))
        .then(Working.start({}).responds({ value }))
        .then(respond({ hidden })),
    );

    expect(() => assemble({ vocabulary: words, composition: { GlobalBoundary } })).toThrow(
      /ordinary reaction "GlobalBoundary" touches RequestBoundary.*unlowered reaction/s,
    );
  });
});

const LocalClosure = reaction(() =>
  when(Working.start({ value: "local" }).responds())
    .where((frames: Frames) => frames)
    .then(Working.record({ value: "reviewed" })),
);

function localAssembly(localBehavior?: {
  revision: string;
  definitions: readonly { kind: "reaction" | "view" | "former"; name: string }[];
}) {
  return assemble({ vocabulary: words, composition: { LocalClosure }, localBehavior });
}

describe("reviewed non-boundary locality", () => {
  test("causal sibling reactions receive isolated plain occurrence values", async () => {
    class MutableConcept {
      mutations = 0;
      observed: boolean[] = [];

      start() {
        return { payload: { changed: false } };
      }

      mutate({ payload }: { payload: { changed: boolean } }) {
        this.mutations += 1;
        this.observed.push(payload.changed);
        return {};
      }
    }
    const mutableWords = vocabulary({ concepts: { Mutable: MutableConcept }, computations: {} });
    const { Mutable } = mutableWords.concepts;
    const Call = endpoint("/call", ({ payload }) =>
      receive().then(Mutable.start({}).responds({ payload })).then(respond({ payload })),
    );
    const LocalMutation = reaction(({ payload }) =>
      when(Mutable.start({}).responds({ payload }))
        .where((frames: Frames) => {
          for (const frame of frames) {
            (frame[payload] as { changed: boolean }).changed = true;
          }
          return frames;
        })
        .then(Mutable.mutate({ payload })),
    );
    const app = assemble({
      vocabulary: mutableWords,
      composition: { LocalMutation, Call },
      localBehavior: {
        revision: "isolated-causal-values-r1",
        definitions: [{ kind: "reaction", name: "LocalMutation" }],
      },
    });

    expect(await app.invoker.invoke("/call", {})).toEqual({
      ok: true,
      value: { payload: { changed: false } },
    });
    expect(app.concepts.Mutable.mutations).toBe(1);
    expect(app.concepts.Mutable.observed).toEqual([true]);
  });

  test("executes with an exact reviewed inventory and survives canonical JSON read-back", async () => {
    const app = localAssembly({
      revision: "review-2026-07-28",
      definitions: [{ kind: "reaction", name: "LocalClosure" }],
    });

    await app.concepts.Working.start({ value: "local" });
    expect(app.concepts.Working.recorded).toEqual(["reviewed"]);

    const inspected = inspectAssembly(app);
    expect(inspected.localBehavior).toEqual({
      contract: {
        revision: "review-2026-07-28",
        definitions: [{ kind: "reaction", name: "LocalClosure" }],
      },
      observed: [{ kind: "reaction", name: "LocalClosure", reasons: ["closure condition"] }],
    });
    expect(inspected.readBack).toContain("Reviewed local behavior");
    expect(inspected.readBack).toContain("LocalClosure — reviewed local: closure condition");
    expect(inspected.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LOCAL_DEFINITION",
        message: expect.stringContaining('revision "review-2026-07-28"'),
      }),
    );

    const manifest = applicationManifest(app);
    expect(JSON.parse(renderApplicationManifest(manifest))).toEqual(manifest);
    expect(manifest.localBehavior).toEqual(inspected.localBehavior);
    expect(manifest.digest).toMatch(/^fnv1a64-[0-9a-f]{16}$/);
    expect(
      planGenerated(manifest, { title: "Reviewed local application" }).entries.find(
        ({ kind }) => kind === "specification",
      )?.content,
    ).toContain("Review revision: `review-2026-07-28`");
  });

  test("rejects missing, stale, extra, duplicate, malformed, and unused contracts", () => {
    expect(() => localAssembly()).toThrow(/requires an exact localBehavior review contract/);
    expect(() => localAssembly({ revision: "r1", definitions: [] })).toThrow(
      /missing reaction "LocalClosure"/,
    );
    expect(() =>
      localAssembly({
        revision: "r1",
        definitions: [{ kind: "reaction", name: "OldClosure" }],
      }),
    ).toThrow(/missing reaction "LocalClosure".*stale or extra reaction "OldClosure"/s);
    expect(() =>
      localAssembly({
        revision: "r1",
        definitions: [
          { kind: "reaction", name: "LocalClosure" },
          { kind: "view", name: "unused" },
        ],
      }),
    ).toThrow(/stale or extra view "unused"/);
    expect(() =>
      localAssembly({
        revision: "r1",
        definitions: [
          { kind: "reaction", name: "LocalClosure" },
          { kind: "reaction", name: "LocalClosure" },
        ],
      }),
    ).toThrow(/duplicate reaction "LocalClosure"/);
    expect(() =>
      localAssembly({ revision: " ", definitions: [{ kind: "reaction", name: "LocalClosure" }] }),
    ).toThrow(/revision must be a non-empty string/);
    expect(() =>
      localAssembly({
        revision: "r1",
        definitions: [{ kind: "bogus", name: "LocalClosure" }],
      } as never),
    ).toThrow(/kind must be reaction, view, or former/);
    expect(() =>
      assemble({
        vocabulary: words,
        composition: {},
        localBehavior: { revision: "r1", definitions: [] },
      }),
    ).toThrow(/contract is unused/);
  });

  test("does not reclassify regexp, oneOf, or named-vocabulary computation behavior", () => {
    const portableWords = vocabulary({
      concepts: {},
      computations: { accepted: ({ value }) => value === "accepted" },
    });
    const { accepted } = portableWords.computations;
    const Portable = endpoint("/portable", () =>
      receive({ first: /^ok$/, second: oneOf("a", "b") })
        .where(accepted({ value: "accepted" }))
        .then(respond({ ok: true })),
    );
    const app = assemble({ vocabulary: portableWords, composition: { Portable } });

    expect(inspectAssembly(app).localBehavior).toEqual({ contract: null, observed: [] });
    expect(applicationDependencyGraph(applicationManifest(app)).nodes).not.toContainEqual(
      expect.objectContaining({ kind: "opaque" }),
    );
  });
});

function firstCustom() {
  return true;
}

function secondCustom() {
  return true;
}

const LocalCustom = reaction(() =>
  when(Working.start({ value: "graph" }).responds())
    .where(custom(firstCustom, [], []), custom(secondCustom, [], []))
    .then(Working.record({ value: "graph" })),
);
const PortableLocal = reaction(() =>
  when(Working.start({ value: "graph" }).responds()).then(Working.record({ value: "graph" })),
);

function graphAssembly(revision: string, local = true) {
  return assemble({
    vocabulary: words,
    composition: { Ping, Local: local ? LocalCustom : PortableLocal },
    ...(local
      ? {
          localBehavior: {
            revision,
            definitions: [{ kind: "reaction" as const, name: "Local" }],
          },
        }
      : {}),
  });
}

describe("opaque dependency graph fallbacks", () => {
  test("gives multiple custom and identity occurrences distinct stable nodes", () => {
    const customGraph = applicationDependencyGraph(applicationManifest(graphAssembly("r1")));
    expect(customGraph.nodes.filter(({ kind }) => kind === "opaque")).toHaveLength(2);
    expect(new Set(customGraph.nodes.map(({ id }) => id)).size).toBe(customGraph.nodes.length);

    class Identity {}
    const first = new Identity();
    const second = new Identity();
    const IdentityLocal = reaction(() =>
      when(Working.start({ value: "identity", first, second } as never).responds()).then(
        Working.record({ value: "identity" }),
      ),
    );
    const identityApp = assemble({
      vocabulary: words,
      composition: { IdentityLocal },
      localBehavior: {
        revision: "identity-r1",
        definitions: [{ kind: "reaction", name: "IdentityLocal" }],
      },
    });
    const identityGraph = applicationDependencyGraph(applicationManifest(identityApp));
    expect(identityGraph.nodes.filter(({ kind }) => kind === "opaque")).toHaveLength(2);
  });

  test("revision-only changes alter manifest identity and force whole-application impact", () => {
    const before = applicationManifest(graphAssembly("r1"));
    const after = applicationManifest(graphAssembly("r2"));
    const impact = applicationImpact(before, after);

    expect(after.digest).not.toBe(before.digest);
    expect(impact.directlyChanged).toContain("review:local-behavior");
    expect(impact.wholeApplication).toBe(true);
    expect(impact.endpoints).toContain("/ping#Ping");
  });

  test("removing the last opaque behavior still uses the before-graph fallback", () => {
    const impact = applicationImpact(
      applicationManifest(graphAssembly("r1")),
      applicationManifest(graphAssembly("portable", false)),
    );

    expect(impact.directlyChanged.some((id) => id.startsWith("opaque:"))).toBe(true);
    expect(impact.wholeApplication).toBe(true);
    expect(impact.endpoints).toContain("/ping#Ping");
  });
});
