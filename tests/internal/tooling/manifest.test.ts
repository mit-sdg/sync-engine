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
  diagnosticsFail,
  renderApplicationManifest,
} from "@mit-sdg/sync-engine/tooling";
import type { AppIR, ActionTriggerIR } from "@engine/reads/ir";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

const words = vocabulary({ concepts: {}, computations: {} });
const First = endpoint(
  "/shared",
  ({ value }) => receive({ value }).then(respond({ source: "first", value })),
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
      version: 3,
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
    expect(diagnosticsFail(manifest.diagnostics)).toBe(false);
    expect(diagnosticsFail(manifest.diagnostics, "warnings")).toBe(true);
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

  test("does not prove coverage through an intermediate action posture", () => {
    const Chained = endpoint("/chained", ({ item, opened }) =>
      receive({ item })
        .then(Looking.open({ item }).responds({ item: opened }))
        .then(respond({ opened })),
    );

    expect(
      applicationManifest(
        assemble({ vocabulary: lookup, composition: { Chained } }),
      ).diagnostics.map(({ code }) => code),
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
    const config = "tests/package/application/generated.config.ts";
    const printed = spawnSync(
      "bun",
      ["src/command/main.ts", "artifacts", "manifest", "--config", config],
      { cwd: root, encoding: "utf8" },
    );
    expect(printed.status).toBe(0);
    expect(JSON.parse(printed.stdout)).toMatchObject({
      format: "sync-engine.application-manifest",
      version: 3,
    });
    expect(printed.stdout.endsWith("\n")).toBe(true);

    const checked = spawnSync(
      "bun",
      [
        "src/command/main.ts",
        "check",
        "--concepts",
        "tests/package/application/src/concepts",
        "--config",
        config,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Application diagnostic check passed");
  });
});
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
