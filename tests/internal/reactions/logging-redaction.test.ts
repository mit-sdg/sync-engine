import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { createRedactor, redact, UNIVERSAL_SENSITIVE_PATTERNS } from "@engine/utils/redaction";

describe("redact — universal credential patterns (no policy registered)", () => {
  test("redacts credential-shaped keys regardless of domain", () => {
    const input = {
      password: "secret123",
      token: "abc123",
      session: "sess-456",
      secret: "shhh",
      authorization: "Bearer x",
      apiKey: "k-1",
      setupKey: "setup-k-1",
    };
    const result = redact(input) as Record<string, unknown>;
    expect(result.password).toBe("[redacted]");
    expect(result.token).toBe("[redacted]");
    expect(result.session).toBe("[redacted]");
    expect(result.secret).toBe("[redacted]");
    expect(result.authorization).toBe("[redacted]");
    expect(result.apiKey).toBe("[redacted]");
    expect(result.setupKey).toBe("[redacted]");
  });

  test("passes through domain fields until a policy is registered", () => {
    const input = { email: "user@example.com", name: "Alice", amount: 5000 };
    const result = redact(input) as Record<string, unknown>;
    expect(result.email).toBe("user@example.com");
    expect(result.name).toBe("Alice");
    expect(result.amount).toBe(5000);
  });

  test("the universal patterns are non-empty (always-on safety net)", () => {
    expect(UNIVERSAL_SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("redact — injected redaction policy", () => {
  test("immutable redactors keep independent policies", () => {
    const scoped = createRedactor({ fields: ["privateField"] });
    const other = createRedactor({ fields: ["otherField"] });

    expect(scoped.redact({ privateField: "a", otherField: "b" })).toEqual({
      privateField: "[redacted]",
      otherField: "b",
    });
    expect(other.redact({ privateField: "a", otherField: "b" })).toEqual({
      privateField: "a",
      otherField: "[redacted]",
    });
  });

  test("redacts exact domain field names once registered", () => {
    const redactor = createRedactor({ fields: ["email", "amount", "fatherName"] });
    const result = redactor.redact({
      email: "user@example.com",
      amount: 5000,
      fatherName: "John Doe",
    }) as Record<string, unknown>;
    expect(result.email).toBe("[redacted]");
    expect(result.amount).toBe("[redacted]");
    expect(result.fatherName).toBe("[redacted]");
  });

  test("applies extra domain patterns on top of the universal set", () => {
    const redactor = createRedactor({ patterns: [/ssn/i] });
    const result = redactor.redact({ ssn: "111-22-3333", token: "t" }) as Record<string, unknown>;
    expect(result.ssn).toBe("[redacted]");
    // Universal patterns apply alongside the injected ones.
    expect(result.token).toBe("[redacted]");
  });

  test("tests global and sticky patterns independently without changing caller state", () => {
    const global = /^private/g;
    const sticky = /^internal/y;
    global.lastIndex = 3;
    sticky.lastIndex = 4;
    const redactor = createRedactor({ patterns: [global, sticky] });

    expect(
      redactor.redact({ privateOne: 1, privateTwo: 2, internalOne: 3, internalTwo: 4 }),
    ).toEqual({
      privateOne: "[redacted]",
      privateTwo: "[redacted]",
      internalOne: "[redacted]",
      internalTwo: "[redacted]",
    });
    expect(global.lastIndex).toBe(3);
    expect(sticky.lastIndex).toBe(4);
  });

  test("field matching is case-insensitive", () => {
    const result = createRedactor({ fields: ["searchname"] }).redact({
      searchName: "Alisa",
    }) as Record<string, unknown>;
    expect(result.searchName).toBe("[redacted]");
  });
});

describe("assembly-scoped redaction", () => {
  test("simultaneous assemblies do not mix domain field policies", async () => {
    class RecordingConcept {
      write({ alpha, beta }: { alpha: string; beta: string }) {
        return { alpha, beta };
      }
    }
    const words = vocabulary({ concepts: { Recording: RecordingConcept }, computations: {} });
    const { Recording } = words.concepts;
    const Write = endpoint("/write", ({ alpha, beta }: Vars) =>
      receive({ alpha, beta })
        .then(Recording.write({ alpha, beta }).responds())
        .then(respond({ ok: true })),
    );
    const alphaApp = assemble({
      vocabulary: words,
      composition: { Write },
      redaction: { fields: ["alpha"] },
      retention: "keepAll",
    });
    const betaApp = assemble({
      vocabulary: words,
      composition: { Write },
      redaction: { fields: ["beta"] },
      retention: "keepAll",
    });

    await Promise.all([
      alphaApp.invoker.invoke("/write", { alpha: "a", beta: "b" }),
      betaApp.invoker.invoke("/write", { alpha: "a", beta: "b" }),
    ]);
    const alphaRecord = [...alphaApp.engine.Action.actions.values()].find(
      ({ input }) => input.alpha !== undefined,
    );
    const betaRecord = [...betaApp.engine.Action.actions.values()].find(
      ({ input }) => input.beta !== undefined,
    );
    expect(alphaRecord?.input).toMatchObject({ alpha: "[redacted]", beta: "b" });
    expect(betaRecord?.input).toMatchObject({ alpha: "a", beta: "[redacted]" });
  });
});

describe("redact — structural behavior (policy-independent)", () => {
  test("recurses into nested objects", () => {
    const result = redact({
      outer: { token: "t", inner: { password: "p", keep: "ok" } },
    }) as Record<string, unknown>;
    const outer = result.outer as Record<string, unknown>;
    expect(outer.token).toBe("[redacted]");
    const inner = outer.inner as Record<string, unknown>;
    expect(inner.password).toBe("[redacted]");
    expect(inner.keep).toBe("ok");
  });

  test("recurses into arrays", () => {
    const result = redact([
      { password: "p1", keep: "a" },
      { password: "p2", keep: "b" },
    ]) as Array<Record<string, unknown>>;
    expect(result[0].password).toBe("[redacted]");
    expect(result[0].keep).toBe("a");
    expect(result[1].password).toBe("[redacted]");
  });

  test("passes through non-sensitive fields", () => {
    const result = redact({
      code: "CS101",
      path: "/api/courses",
      id: "abc-123",
    }) as Record<string, unknown>;
    expect(result.code).toBe("CS101");
    expect(result.path).toBe("/api/courses");
    expect(result.id).toBe("abc-123");
  });

  test("passes through primitives unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  test("passes through empty objects and arrays", () => {
    expect(redact({})).toEqual({});
    expect(redact([])).toEqual([]);
  });
});

describe("Reacting default logging", () => {
  test("default logging level is OFF", () => {
    const reaction = new Reacting();
    expect(reaction.logging).toBe(Logging.OFF);
  });

  test("logging can be changed to VERBOSE at runtime", () => {
    const reaction = new Reacting();
    reaction.logging = Logging.VERBOSE;
    expect(reaction.logging).toBe(Logging.VERBOSE);
  });

  test("logging can be changed to TRACE at runtime", () => {
    const reaction = new Reacting();
    reaction.logging = Logging.TRACE;
    expect(reaction.logging).toBe(Logging.TRACE);
  });
});
