import { describe, expect, test } from "vite-plus/test";
import {
  compute,
  earlier,
  is,
  no,
  vocabulary,
  where,
  whether,
} from "@mit-sdg/sync-engine/language";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import {
  applicationDiagnostics,
  applicationManifest,
  applicationManifestDigest,
  diagnosticsFail,
  parseApplicationManifest,
  renderApplicationManifest,
  validateApplicationManifest,
} from "@mit-sdg/sync-engine/tooling";
import type { AppIR, ActionTriggerIR } from "@engine/reads/ir";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

const words = vocabulary({ concepts: {}, computations: {} });
const First = endpoint(
  "/shared",
  ({ value }) =>
    receive({ value })
      .afterFlowSettles()
      .then(respond({ source: "first", value })),
  {
    input: { required: ["value"], defaults: { z: 1, a: 2 } },
    validators: {
      input: (value) =>
        typeof (value as { value?: unknown }).value === "string" ? { ok: true } : { ok: false },
      output: () => ({ ok: true }),
    },
  },
);
const Second = endpoint("/shared", ({ value }) =>
  receive({ value }).then(respond({ source: "second", value })),
);

function application(reverse = false) {
  return assemble({
    vocabulary: words,
    composition: reverse ? { Second, First } : { First, Second },
    retention: "keepAll",
  });
}

class LookingConcept {
  static readonly queries = { _get: "optional" } as const;

  _get(_: { item: string }): { item: string }[] {
    return [];
  }

  _number(_: { value: number }): { value: number }[] {
    return [];
  }

  open({ item }: { item: string }) {
    return { item };
  }

  pair({ first, second }: { first: string; second: string }) {
    return { first, second };
  }
}

const lookup = vocabulary({
  concepts: { Looking: LookingConcept },
  computations: {
    normalize: ({ item }: { item: string }) => item.trim().toLowerCase(),
  },
});
const { Looking } = lookup.concepts;

function lookupApplication(duplicatePositive = false) {
  const Get = endpoint("/get", ({ item }) => {
    const found = where(Looking._get({ item })).then(respond({ item })).named("found");
    const missing = where(no(Looking._get({ item })))
      .then(respond({ error: "NOT_FOUND" }))
      .named("missing");
    if (!duplicatePositive) return receive({ item }).then(found, missing);
    const alsoFound = where(Looking._get({ item }))
      .then(respond({ item, source: "duplicate" }))
      .named("also-found");
    return receive({ item }).then(found, missing, alsoFound);
  });
  return assemble({ vocabulary: lookup, composition: { Get } });
}

describe("application manifest", () => {
  test("contains complete static design and structured endpoint diagnostics", () => {
    const manifest = applicationManifest(application());

    expect(manifest).toMatchObject({
      format: "sync-engine.application-manifest",
      version: 5,
      generator: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
      digest: expect.stringMatching(/^fnv1a64-[0-9a-f]{16}$/),
      endpoints: [
        {
          name: "First",
          path: "/shared",
          reactions: ["First"],
          validators: { input: true, output: true },
        },
        {
          name: "Second",
          path: "/shared",
          reactions: ["Second"],
          validators: { input: true, output: true },
        },
      ],
    });
    expect(manifest.diagnostics.map(({ code }) => code)).toContain("ENDPOINT_PATH_OVERLAP");
    expect(manifest.application.reactions.find(({ name }) => name === "First")?.deferred).toBe(
      true,
    );
    expect(diagnosticsFail(manifest.diagnostics)).toBe(false);
    expect(diagnosticsFail(manifest.diagnostics, "warnings")).toBe(true);
  });

  test("inventories every standard and unused vocabulary computation in name order", () => {
    const complete = vocabulary({
      concepts: {},
      computations: {
        unused: ({ right, left }: { right: string; left: string }) => `${left}:${right}`,
        unreadable: (input: { value: string }) => input.value,
      },
    });
    const manifest = applicationManifest(assemble({ vocabulary: complete, composition: {} }));

    expect(manifest.computations).toEqual([
      { name: "among", source: "standard", inputs: ["value", "collection"] },
      { name: "ge", source: "standard", inputs: ["left", "right"] },
      { name: "gt", source: "standard", inputs: ["left", "right"] },
      { name: "le", source: "standard", inputs: ["left", "right"] },
      { name: "lt", source: "standard", inputs: ["left", "right"] },
      { name: "unreadable", source: "vocabulary" },
      { name: "unused", source: "vocabulary", inputs: ["right", "left"] },
    ]);
  });

  test("uses canonical member roles and contracts under a structural replacement", () => {
    class CanonicalContract {
      static readonly purpose = "Keep the canonical contract.";
      static readonly queries = { _lookup: "optional" } as const;
      static readonly outcomes = { save: { refusals: ["DENIED"] } } as const;

      save({ item, shelf }: { item: string; shelf: string }) {
        return { item, shelf };
      }

      _lookup({ item }: { item: string }): { item: string }[] {
        return [{ item }];
      }
    }
    const declared = vocabulary({
      concepts: { Contract: CanonicalContract },
      computations: {},
    });
    class ReplacementContract {
      static readonly purpose = "Do not replace the canonical purpose.";
      static readonly queries = { _lookup: "many" } as const;
      static readonly outcomes = { save: { refusals: ["REPLACEMENT_ONLY"] } } as const;

      save({ replacement }: { replacement: string }) {
        return { replacement };
      }

      _lookup({ replacement }: { replacement: string }) {
        return [{ item: replacement }];
      }
    }
    const manifest = applicationManifest(
      assemble({
        vocabulary: declared,
        instances: { Contract: new ReplacementContract() as never },
        composition: {},
      }),
    );

    expect(manifest.concepts.find(({ name }) => name === "Contract")).toEqual({
      name: "Contract",
      purpose: "Keep the canonical contract.",
      actions: [{ name: "save", roles: ["item", "shelf"], refusals: ["DENIED"] }],
      queries: [{ name: "_lookup", roles: ["item"], returns: "optional" }],
    });
    expect(manifest.conceptImplementations.find(({ concept }) => concept === "Contract")).toEqual({
      concept: "Contract",
      canonical: { owner: "application", constructorName: "CanonicalContract" },
      selected: { via: "instances", constructorName: "ReplacementContract" },
    });
  });

  test("records core, default, initialize, class-instance, and structural selections", () => {
    class DefaultImplementation {}
    class InitializedImplementation {
      constructor(readonly connection: string) {}
    }
    class SuppliedCanonical {}
    class SuppliedReplacement {}
    class StructuralCanonical {}
    const declared = vocabulary({
      concepts: {
        Supplied: SuppliedCanonical,
        Structural: StructuralCanonical,
        Initialized: InitializedImplementation,
        Default: DefaultImplementation,
      },
      computations: {},
    });
    const manifest = applicationManifest(
      assemble({
        vocabulary: declared,
        initialize: { Initialized: ["primary"] },
        instances: { Supplied: new SuppliedReplacement(), Structural: {} },
        composition: {},
      }),
    );

    expect(manifest.conceptImplementations).toEqual([
      {
        concept: "Default",
        canonical: { owner: "application", constructorName: "DefaultImplementation" },
        selected: { via: "default" },
      },
      {
        concept: "Initialized",
        canonical: { owner: "application", constructorName: "InitializedImplementation" },
        selected: { via: "initialize" },
      },
      {
        concept: "RequestBoundary",
        canonical: { owner: "core", constructorName: "Requesting" },
        selected: { via: "core" },
      },
      {
        concept: "Structural",
        canonical: { owner: "application", constructorName: "StructuralCanonical" },
        selected: { via: "instances" },
      },
      {
        concept: "Supplied",
        canonical: { owner: "application", constructorName: "SuppliedCanonical" },
        selected: { via: "instances", constructorName: "SuppliedReplacement" },
      },
    ]);
    expect(JSON.stringify(manifest.conceptImplementations)).not.toContain("primary");
  });

  test("reserves RequestBoundary for its core inventory and provenance", () => {
    class ApplicationBoundary {}
    const declared = vocabulary({
      concepts: { RequestBoundary: ApplicationBoundary },
      computations: {},
    });

    expect(() => assemble({ vocabulary: declared, composition: {} })).toThrow(
      '"RequestBoundary" is reserved for the core request boundary',
    );
  });

  test("does not assume sibling reads share one state snapshot", () => {
    expect(applicationManifest(lookupApplication()).diagnostics.map(({ code }) => code)).toEqual([
      "MISSING_ENDPOINT_FALLBACK",
    ]);
  });

  test("reports a duplicate positive branch beside an unproved read pair", () => {
    const diagnostics = applicationManifest(lookupApplication(true)).diagnostics;
    expect(diagnostics.map(({ code }) => code)).toEqual([
      "ENDPOINT_PATH_OVERLAP",
      "MISSING_ENDPOINT_FALLBACK",
    ]);
    expect(diagnostics[0]).toEqual({
      severity: "warning",
      code: "ENDPOINT_PATH_OVERLAP",
      definition: { kind: "endpoint", name: "Get" },
      endpoint: { name: "Get", path: "/get" },
      message:
        'Endpoint "Get" at "/get" has potentially overlapping answer paths "Get:also-found" and "Get:found": the complete answer guards are identical; all matching paths run.',
    });
  });

  test("reports a total branch that competes with a conditional answer", () => {
    const Race = endpoint("/race", ({ item }) =>
      receive({ item }).then(
        where(Looking._get({ item }))
          .then(respond({ found: true }))
          .named("found"),
        respond({ found: false }).named("otherwise"),
      ),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Race } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["ENDPOINT_PATH_OVERLAP"]);
    expect(diagnostics[0]?.message).toContain("one answer path is unconditional");
  });

  test("distinguishes disjoint literal receives but leaves their coverage unproved", () => {
    const Created = endpoint("/sort", () =>
      receive({ sort: "created" }).then(respond({ sort: "created" })),
    );
    const Activity = endpoint("/sort", () =>
      receive({ sort: "activity" }).then(respond({ sort: "activity" })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Created, Activity } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("recognizes a bare existence branch that subsumes a more specific read", () => {
    const Overlap = endpoint("/overlap", ({ item }) =>
      receive({ item }).then(
        where(Looking._get({ item }).is({ item }))
          .then(respond({ found: true }))
          .named("specific"),
        where(Looking._get({ item }))
          .then(respond({ found: false }))
          .named("exists"),
      ),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Overlap } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "ENDPOINT_PATH_OVERLAP",
      "MISSING_ENDPOINT_FALLBACK",
    ]);
    expect(diagnostics[0]?.message).toContain("bare existence read");
  });

  test("treats whether as non-dropping for endpoint coverage", () => {
    const Always = endpoint("/always", ({ item, found }) =>
      receive({ item })
        .where(whether(Looking._get({ item }).is({ item: found })))
        .then(respond({ found })),
    );

    expect(
      applicationManifest(assemble({ vocabulary: lookup, composition: { Always } })).diagnostics,
    ).toEqual([]);
  });

  test("distinguishes fresh computations from computations that can filter", () => {
    const Fresh = endpoint("/fresh-compute", ({ item, normalized }) =>
      receive({ item })
        .where(compute(lookup.computations.normalize, { item }, normalized))
        .then(respond({ normalized })),
    );
    const Filtering = endpoint("/filtering-compute", ({ item }) =>
      receive({ item })
        .where(compute(lookup.computations.normalize, { item }, item))
        .then(respond({ item })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Fresh, Filtering } }),
    ).diagnostics;
    const fallbacks = diagnostics.filter(({ code }) => code === "MISSING_ENDPOINT_FALLBACK");

    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.endpoint?.path).toBe("/filtering-compute");
  });

  test("keeps authored earlier reads as endpoint guards", () => {
    const Guarded = endpoint("/earlier", ({ item }) =>
      receive({ item }).where(earlier(Looking.open, { item })).then(respond({ item })),
    );

    expect(
      applicationManifest(
        assemble({ vocabulary: lookup, composition: { Guarded } }),
      ).diagnostics.map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("does not treat the current trigger as an earlier occurrence", () => {
    const request: ActionTriggerIR = {
      kind: "action",
      concept: "RequestBoundary",
      action: "request",
      posture: "returned",
      input: { path: "/manual-earlier", requestId: { $var: "requestId" } },
      output: {},
    };
    const app: AppIR = {
      reactions: [
        {
          name: "ManualEarlier",
          when: [request],
          where: [{ op: "earlier", when: request }],
          then: [
            {
              kind: "request",
              concept: "RequestBoundary",
              action: "respond",
              input: { requestId: { $var: "requestId" }, ok: true },
            },
          ],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    };
    const wire: WireContractsIR = {
      endpoints: [
        {
          path: "/manual-earlier",
          input: { kind: "object", fields: [] },
          output: {
            kind: "object",
            fields: [{ key: "ok", type: { kind: "literal", value: true } }],
          },
          errors: [],
          openError: false,
        },
      ],
      appWide: [],
    };

    expect(
      applicationDiagnostics(
        app,
        [{ name: "ManualEarlier", path: "/manual-earlier", reactions: ["ManualEarlier"] }],
        wire,
      ).map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("requires responses to target the traced request id", () => {
    const variableRequest: ActionTriggerIR = {
      kind: "action",
      concept: "RequestBoundary",
      action: "request",
      posture: "returned",
      input: { path: "/malformed-response", requestId: { $var: "requestId" } },
      output: {},
    };
    const literalRequest: ActionTriggerIR = {
      ...variableRequest,
      input: { path: "/malformed-response", requestId: "fixed" },
    };
    const app: AppIR = {
      reactions: [
        {
          name: "WrongResponseId",
          when: [variableRequest],
          where: [],
          then: [
            {
              kind: "request",
              concept: "RequestBoundary",
              action: "respond",
              input: { requestId: "different", ok: true },
            },
          ],
        },
        {
          name: "MissingResponseId",
          when: [variableRequest],
          where: [],
          then: [
            {
              kind: "request",
              concept: "RequestBoundary",
              action: "respond",
              input: { ok: true },
            },
          ],
        },
        {
          name: "LiteralRequestId",
          when: [literalRequest],
          where: [],
          then: [
            {
              kind: "request",
              concept: "RequestBoundary",
              action: "respond",
              input: { requestId: "fixed", ok: true },
            },
          ],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    };
    const wire: WireContractsIR = {
      endpoints: [
        {
          path: "/malformed-response",
          input: { kind: "object", fields: [] },
          output: {
            kind: "object",
            fields: [{ key: "ok", type: { kind: "literal", value: true } }],
          },
          errors: [],
          openError: false,
        },
      ],
      appWide: [],
    };

    expect(
      applicationDiagnostics(
        app,
        [
          {
            name: "MalformedResponse",
            path: "/malformed-response",
            reactions: ["WrongResponseId", "MissingResponseId", "LiteralRequestId"],
          },
        ],
        wire,
      ).map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("requires the canonical receive trigger shape for totality", () => {
    const aliasedRequest: ActionTriggerIR = {
      kind: "action",
      concept: "RequestBoundary",
      action: "request",
      posture: "returned",
      input: {
        path: "/malformed-receive",
        requestId: { $var: "requestId" },
        token: { $var: "requestId" },
      },
      output: {},
    };
    const outputFilteringRequest: ActionTriggerIR = {
      kind: "action",
      concept: "RequestBoundary",
      action: "request",
      posture: "returned",
      input: { path: "/malformed-receive", requestId: { $var: "otherRequestId" } },
      output: { accepted: true },
    };
    const app: AppIR = {
      reactions: [aliasedRequest, outputFilteringRequest].map((request, index) => ({
        name: `MalformedReceive${index + 1}`,
        when: [request],
        where: [],
        then: [
          {
            kind: "request" as const,
            concept: "RequestBoundary",
            action: "respond",
            input: {
              requestId: request.input.requestId,
              ok: true,
            },
          },
        ],
      })),
      views: [],
      formers: [],
      unlowered: [],
    };
    const wire: WireContractsIR = {
      endpoints: [
        {
          path: "/malformed-receive",
          input: {
            kind: "object",
            fields: [{ key: "token", type: { kind: "json" } }],
          },
          output: {
            kind: "object",
            fields: [{ key: "ok", type: { kind: "literal", value: true } }],
          },
          errors: [],
          openError: false,
        },
      ],
      appWide: [],
    };

    expect(
      applicationDiagnostics(
        app,
        [
          {
            name: "MalformedReceive",
            path: "/malformed-receive",
            reactions: ["MalformedReceive1", "MalformedReceive2"],
          },
        ],
        wire,
      ).map(({ code }) => code),
    ).toContain("MISSING_ENDPOINT_FALLBACK");
  });

  test("does not treat a provenance-pinned boundary request as externally total", () => {
    const Direct = endpoint("/pinned-request", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(assemble({ vocabulary: lookup, composition: { Direct } }));
    const pinned: AppIR = {
      ...manifest.application,
      reactions: manifest.application.reactions.map((reaction) =>
        reaction.name === "Direct"
          ? {
              ...reaction,
              when: reaction.when.map((trigger) =>
                trigger.kind === "action" ? { ...trigger, by: "Ghost" } : trigger,
              ),
            }
          : reaction,
      ),
    };

    expect(
      applicationDiagnostics(pinned, manifest.endpoints, manifest.wire).map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("requires a complementary read pair to cover admitted request shapes", () => {
    const OptionalInput = endpoint(
      "/optional-input",
      ({ item }) =>
        receive({ item }).then(
          where(Looking._get({ item }))
            .then(respond({ found: true }))
            .named("found"),
          where(no(Looking._get({ item })))
            .then(respond({ found: false }))
            .named("missing"),
        ),
      { input: { defaults: { item: "default" } } },
    );

    expect(
      applicationManifest(
        assemble({ vocabulary: lookup, composition: { OptionalInput } }),
      ).diagnostics.map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("attributes answer paths by request path rather than reaction-name prefixes", () => {
    const Get = endpoint("/get", () => receive().then(respond({ ok: true })));
    const Shadow = endpoint("/shadow", ({ item }) =>
      receive({ item }).where(Looking._get({ item })).then(respond({ item })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Get, "Get:shadow": Shadow } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
    expect(diagnostics[0]?.endpoint).toEqual({ name: "Get:shadow", path: "/shadow" });
  });

  test("does not equate guards whose local variables bind different request fields", () => {
    const Left = endpoint("/alpha", ({ first, second }) =>
      receive({ left: first, right: second })
        .where(Looking._get({ item: first }))
        .then(respond({ side: "left" })),
    );
    const Right = endpoint("/alpha", ({ first, second }) =>
      receive({ left: second, right: first })
        .where(Looking._get({ item: first }))
        .then(respond({ side: "right" })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Left, Right } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("treats caller-controlled correlation literals as request guards", () => {
    const FirstCorrelation = endpoint("/correlation", () =>
      receive({ correlationId: "first" }).then(respond({ source: "first" })),
    );
    const SecondCorrelation = endpoint("/correlation", () =>
      receive({ correlationId: "second" }).then(respond({ source: "second" })),
    );
    const diagnostics = applicationManifest(
      assemble({
        vocabulary: lookup,
        composition: { FirstCorrelation, SecondCorrelation },
      }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("proves coverage through canonical linear action continuations", () => {
    const Chained = endpoint("/chained", ({ item }) =>
      receive({ item }).then(Looking.open({ item }).responds()).then(respond({ item })),
    );
    const MultiHop = endpoint("/multi-hop", ({ item }) =>
      receive({ item })
        .then(Looking.open({ item }).responds())
        .then(Looking.open({ item }).responds())
        .then(respond({ item })),
    );
    const first = Symbol("value");
    const second = Symbol("value");
    const AlphaNamed = endpoint("/alpha-chain", () =>
      receive({ first, second })
        .then(Looking.pair({ second, first }).responds())
        .then(respond({ ok: true })),
    );
    const Deferred = endpoint("/deferred-chain", () =>
      receive()
        .then(Looking.open({ item: "later" }).responds())
        .afterFlowSettles()
        .then(respond({ ok: true })),
    );

    expect(
      applicationManifest(
        assemble({
          vocabulary: lookup,
          composition: { AlphaNamed, Chained, Deferred, MultiHop },
        }),
      ).diagnostics,
    ).toEqual([]);
  });

  test("reserves standard boundary outcome names across lowered families", () => {
    const Reserved = endpoint("/reserved-outcome", () => {
      const answer = respond({ ok: true });
      answer.stepName = "DeliverFaultToAsker";
      return receive()
        .then(Looking.open({ item: "reserved" }).responds())
        .then(answer);
    });

    expect(() => assemble({ vocabulary: lookup, composition: { Reserved } })).toThrow(
      'reaction name "DeliverFaultToAsker" is reserved for boundary outcome delivery',
    );
  });

  test("preserves overlap diagnostics for competing total action chains", () => {
    const FirstChain = endpoint("/chain-race", ({ item }) =>
      receive({ item }).then(Looking.open({ item }).responds()).then(respond({ item })),
    );
    const SecondChain = endpoint("/chain-race", ({ item }) =>
      receive({ item })
        .then(Looking.open({ item }).responds())
        .then(respond({ item, source: "second" })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { FirstChain, SecondChain } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["ENDPOINT_PATH_OVERLAP"]);
    expect(diagnostics[0]?.message).toContain('"FirstChain" and "SecondChain"');
    expect(diagnostics[0]?.message).toContain("one root action chain covers every settled outcome");
  });

  test("recognizes only action literals whose representation survives dispatch", () => {
    const LiteralChain = endpoint("/literal-chain", () =>
      receive()
        .then(Looking.open({ item: { $kind: "literal" } as never }).responds())
        .then(respond({ ok: true })),
    );
    const manifest = applicationManifest(
      assemble({ vocabulary: lookup, composition: { LiteralChain } }),
    );
    expect(manifest.diagnostics).toEqual([]);

    const literal = Object.assign(Object.create(null) as Record<string, unknown>, { safe: true });
    const root = manifest.application.reactions.find(({ name }) => name === "LiteralChain")!;
    root.then[0].input.item = literal as never;
    const continuation = manifest.application.reactions.find(
      ({ name }) => name === "LiteralChain#2",
    )!;
    (continuation.when[0] as ActionTriggerIR).input.item = literal as never;

    expect(
      applicationDiagnostics(manifest.application, manifest.endpoints, manifest.wire).map(
        ({ code }) => code,
      ),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("keeps intermediate output patterns as endpoint guards", () => {
    const Filtered = endpoint("/filtered-chain", ({ item, opened }) =>
      receive({ item })
        .then(Looking.open({ item }).responds({ item: opened }))
        .then(respond({ opened })),
    );

    expect(
      applicationManifest(
        assemble({ vocabulary: lookup, composition: { Filtered } }),
      ).diagnostics.map(({ code }) => code),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("keeps guards at every stage of an action chain", () => {
    const RootGuard = endpoint("/root-guard", ({ item }) =>
      receive({ item })
        .where(Looking._get({ item }))
        .then(Looking.open({ item }).responds())
        .then(respond({ item })),
    );
    const LaterGuard = endpoint("/later-guard", ({ item }) =>
      receive({ item })
        .then(Looking.open({ item }).responds())
        .then(where(Looking._get({ item })).then(respond({ item })).named("found")),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { RootGuard, LaterGuard } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "MISSING_ENDPOINT_FALLBACK",
      "MISSING_ENDPOINT_FALLBACK",
    ]);
  });

  test("requires standard refusal and fault delivery for action-chain coverage", () => {
    const Chained = endpoint("/chained", ({ item }) =>
      receive({ item }).then(Looking.open({ item }).responds()).then(respond({ item })),
    );
    const manifest = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Chained } }),
    );
    for (const missing of ["DeliverRefusalToAsker", "DeliverFaultToAsker"]) {
      const withoutFunnel: AppIR = {
        ...manifest.application,
        reactions: manifest.application.reactions.filter(({ name }) => name !== missing),
      };

      expect(
        applicationDiagnostics(withoutFunnel, manifest.endpoints, manifest.wire).map(
          ({ code }) => code,
        ),
      ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
    }

    const fault = manifest.application.reactions.find(
      ({ name }) => name === "DeliverFaultToAsker",
    )!;
    const faultTrigger = fault.when[0];
    if (faultTrigger.kind !== "channel") throw new Error("expected the standard fault channel");
    faultTrigger.exceptBy = [];
    expect(
      applicationDiagnostics(manifest.application, manifest.endpoints, manifest.wire).map(
        ({ code }) => code,
      ),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("analyzes only the active definition when imported reaction names repeat", () => {
    const Chained = endpoint("/shadowed-answer", ({ item }) =>
      receive({ item }).then(Looking.open({ item }).responds()).then(respond({ item })),
    );
    const manifest = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Chained } }),
    );
    const answer = manifest.application.reactions.find(({ name }) => name === "Chained#2")!;
    manifest.application.reactions.push({
      ...answer,
      then: [
        {
          kind: "request",
          concept: "Looking",
          action: "open",
          input: { item: "shadow" },
        },
      ],
    });

    expect(
      applicationDiagnostics(manifest.application, manifest.endpoints, manifest.wire).map(
        ({ code }) => code,
      ),
    ).toEqual(["MISSING_ENDPOINT_FALLBACK"]);
  });

  test("preserves Object.is number distinctions in endpoint proofs", () => {
    const NegativeZero = endpoint("/zero", () =>
      receive({ value: -0 }).then(respond({ value: -0 })),
    );
    const PositiveZero = endpoint("/zero", () => receive({ value: 0 }).then(respond({ value: 0 })));
    const NumberPartition = endpoint("/number-partition", () =>
      receive().then(
        where(Looking._number({ value: -0 }))
          .then(respond({ found: true }))
          .named("negative-zero"),
        where(no(Looking._number({ value: 0 })))
          .then(respond({ found: false }))
          .named("positive-zero"),
      ),
    );
    const diagnostics = applicationManifest(
      assemble({
        vocabulary: lookup,
        composition: { NegativeZero, PositiveZero, NumberPartition },
      }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "MISSING_ENDPOINT_FALLBACK",
      "MISSING_ENDPOINT_FALLBACK",
    ]);
  });

  test("does not claim overlap with a request constraint of unknown inhabitance", () => {
    const Always = endpoint("/regexp", () => receive().then(respond({ source: "always" })));
    const Impossible = endpoint("/regexp", () =>
      receive({ item: /(?!)/u }).then(respond({ source: "impossible" })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Always, Impossible } }),
    ).diagnostics;

    expect(diagnostics.some(({ code }) => code === "ENDPOINT_PATH_OVERLAP")).toBe(false);
  });

  test("describes structurally possible guard overlap as potential", () => {
    const Always = endpoint("/potential", () => receive().then(respond({ source: "always" })));
    const Impossible = endpoint("/potential", () =>
      receive()
        .where(is.lt(1, 0))
        .then(respond({ source: "impossible" })),
    );
    const diagnostics = applicationManifest(
      assemble({ vocabulary: lookup, composition: { Always, Impossible } }),
    ).diagnostics;

    expect(diagnostics.map(({ code }) => code)).toEqual(["ENDPOINT_PATH_OVERLAP"]);
    expect(diagnostics[0]?.message).toContain("potentially overlapping");
  });

  test("is JSON-round-trippable and byte-identical for equivalent assembly order", () => {
    const forward = renderApplicationManifest(applicationManifest(application()));
    const reverse = renderApplicationManifest(applicationManifest(application(true)));

    expect(JSON.parse(forward)).toEqual(JSON.parse(reverse));
    expect(forward).toBe(reverse);
    expect(forward).toMatch(/"defaults": \{\n\s+"a": 2,\n\s+"z": 1/);
  });

  test("validates, parses, and recomputes the format-owned canonical digest", () => {
    const manifest = applicationManifest(application());
    expect(applicationManifestDigest(manifest)).toBe(manifest.digest);
    expect(parseApplicationManifest(renderApplicationManifest(manifest))).toEqual(manifest);
    expect(() => validateApplicationManifest(manifest)).not.toThrow();

    const stale = { ...manifest, digest: "fnv1a64-0000000000000000" };
    expect(applicationManifestDigest(stale)).toBe(manifest.digest);
    expect(() => validateApplicationManifest(stale)).toThrow(/\$\.digest.*canonical digest/);

    const inventoryTampered = {
      ...manifest,
      computations: manifest.computations.map((computation, index) =>
        index === 0 && computation.inputs !== undefined
          ? { ...computation, inputs: [...computation.inputs].reverse() }
          : computation,
      ),
    };
    expect(applicationManifestDigest(inventoryTampered)).not.toBe(manifest.digest);
    expect(() => validateApplicationManifest(inventoryTampered)).toThrow(
      /\$\.digest.*canonical digest/,
    );
  });

  test("rejects version 4 rather than upconverting it", () => {
    const {
      computations: _computations,
      conceptImplementations: _conceptImplementations,
      ...previousShape
    } = applicationManifest(application());
    const version4 = { ...previousShape, version: 4 };

    expect(() => validateApplicationManifest(version4)).toThrow(/\$\.version.*expected 5/);
    expect(() => parseApplicationManifest(JSON.stringify(version4))).toThrow(
      /\$\.version.*expected 5/,
    );
  });

  test("rejects malformed computation and implementation inventories", () => {
    const manifest = applicationManifest(application());
    const [first, ...rest] = manifest.computations;

    expect(() =>
      validateApplicationManifest({
        ...manifest,
        computations: [{ ...first, inputs: ["value", "value"] }, ...rest],
      }),
    ).toThrow("$.computations[0].inputs[1]");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        computations: [{ ...first, inputs: [""] }, ...rest],
      }),
    ).toThrow("$.computations[0].inputs[0]");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        computations: [...manifest.computations, first],
      }),
    ).toThrow(/\$\.computations\[5\]\.name.*duplicates/);
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        application: {
          ...manifest.application,
          reactions: manifest.application.reactions.map((reaction, index) =>
            index === 0
              ? {
                  ...reaction,
                  where: [{ op: "holds", computation: "missing", in: {} }],
                }
              : reaction,
          ),
        },
      }),
    ).toThrow("$.application.reactions[0].where[0].computation");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: [],
      }),
    ).toThrow(/\$\.conceptImplementations.*RequestBoundary/);
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: [
          ...manifest.conceptImplementations,
          manifest.conceptImplementations[0],
        ],
      }),
    ).toThrow(/\$\.conceptImplementations\[1\]\.concept.*duplicates/);
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: manifest.conceptImplementations.map((entry) => ({
          ...entry,
          selected: { ...entry.selected, floor: "forged" },
        })),
      }),
    ).toThrow("$.conceptImplementations[0].selected.floor");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: manifest.conceptImplementations.map((entry) => ({
          ...entry,
          selected: { ...entry.selected, constructorName: "ForgedBoundary" },
        })),
      }),
    ).toThrow("$.conceptImplementations[0].selected.constructorName");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: manifest.conceptImplementations.map((entry) => ({
          ...entry,
          canonical: { ...entry.canonical, constructorName: "Object" },
        })),
      }),
    ).toThrow("$.conceptImplementations[0].canonical.constructorName");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        conceptImplementations: manifest.conceptImplementations.map((entry) => ({
          ...entry,
          canonical: { ...entry.canonical, owner: "application" },
        })),
      }),
    ).toThrow("$.conceptImplementations[0].canonical.owner");
  });

  test("rejects endpoint, input-contract, and logical-wire drift", () => {
    const manifest = applicationManifest(application());

    expect(() =>
      validateApplicationManifest({
        ...manifest,
        endpoints: manifest.endpoints.map((endpoint, index) =>
          index === 0 ? { ...endpoint, input: {} } : endpoint,
        ),
      }),
    ).toThrow("$.endpoints[0].input");
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        inputContracts: { ...manifest.inputContracts, "/forged": {} },
      }),
    ).toThrow('$.inputContracts["/forged"]');
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        wire: { ...manifest.wire, endpoints: [] },
      }),
    ).toThrow(/\$\.wire\.endpoints.*\/shared/);
  });

  test("fails closed on malformed manifest JSON with useful structural paths", () => {
    const manifest = applicationManifest(application());
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        application: { ...manifest.application, reactions: "not-an-array" },
      }),
    ).toThrow("$.application.reactions");
    expect(() => validateApplicationManifest({ ...manifest, unexpected: true })).toThrow(
      "$.unexpected",
    );
    expect(() =>
      validateApplicationManifest({
        ...manifest,
        wire: { ...manifest.wire, hidden: undefined },
      }),
    ).toThrow("$.wire.hidden");
    expect(() => parseApplicationManifest("{")).toThrow(/manifest JSON/);
  });

  test("keeps prototype-named defaults in canonical endpoint and contract design data", () => {
    const defaults = JSON.parse(
      '{"__proto__":{"constructor":1,"prototype":2},"constructor":3,"prototype":4}',
    );
    const Special = endpoint("/special", () => receive().then(respond({ ok: true })), {
      input: { defaults },
    });
    const app = assemble({ vocabulary: words, composition: { Special } });
    const manifest = applicationManifest(app);
    const contractDefaults = manifest.inputContracts["/special"].defaults as Record<
      string,
      unknown
    >;
    const endpointDefaults = manifest.endpoints[0].input.defaults as Record<string, unknown>;

    for (const retained of [contractDefaults, endpointDefaults]) {
      expect(Object.hasOwn(retained, "__proto__")).toBe(true);
      expect(Object.hasOwn(retained, "constructor")).toBe(true);
      expect(Object.hasOwn(retained, "prototype")).toBe(true);
      expect(Object.getPrototypeOf(retained)).toBe(Object.prototype);
    }
    const rendered = renderApplicationManifest(manifest);
    const roundTripped = JSON.parse(rendered);
    expect(roundTripped.inputContracts["/special"].defaults).toEqual(defaults);
    expect(roundTripped.endpoints[0].input.defaults).toEqual(defaults);
  });

  test("excludes retained occurrence state", async () => {
    const app = application();
    const before = renderApplicationManifest(applicationManifest(app));
    await app.invoker.invoke("/shared", { value: "recorded" });
    const after = renderApplicationManifest(applicationManifest(app));

    expect(after).toBe(before);
    expect(after).not.toContain("recorded");
    expect(after).not.toContain("occurrences");
  });

  test("the CLI prints canonical manifest JSON and exposes advisory diagnostics", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const config = "tests/packaging/application/generated.config.ts";
    const printed = spawnSync(
      "bun",
      ["src/command/main.ts", "artifacts", "manifest", "--config", config],
      { cwd: root, encoding: "utf8" },
    );
    expect(printed.status).toBe(0);
    expect(JSON.parse(printed.stdout)).toMatchObject({
      format: "sync-engine.application-manifest",
      version: 5,
    });
    expect(printed.stdout.endsWith("\n")).toBe(true);

    const checked = spawnSync("bun", ["src/command/main.ts", "check", "--config", config], {
      cwd: root,
      encoding: "utf8",
    });
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Application diagnostic check passed");
  }, 20_000);
});
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
