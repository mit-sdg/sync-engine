import { afterEach, describe, expect, test } from "bun:test";
import { Logging, SyncConcept, sanitize } from "@sync-engine/engine";
import {
  configureRedaction,
  UNIVERSAL_SENSITIVE_PATTERNS,
} from "@sync-engine/utils/redaction.ts";

// The framework owns only the universal credential patterns; domain fields
// (PII, financials) are the app's policy and are tested app-side. Each test
// that registers a policy resets to the universal-only default afterward.
afterEach(() => configureRedaction({ fields: [] }));

describe("sanitize — universal credential patterns (no policy registered)", () => {
  test("redacts credential-shaped keys regardless of domain", () => {
    const input = {
      password: "secret123",
      token: "abc123",
      session: "sess-456",
      secret: "shhh",
      authorization: "Bearer x",
      apiKey: "k-1",
    };
    const result = sanitize(input) as Record<string, unknown>;
    expect(result.password).toBe("[redacted]");
    expect(result.token).toBe("[redacted]");
    expect(result.session).toBe("[redacted]");
    expect(result.secret).toBe("[redacted]");
    expect(result.authorization).toBe("[redacted]");
    expect(result.apiKey).toBe("[redacted]");
  });

  test("passes through domain fields until a policy is registered", () => {
    const input = { email: "user@example.com", name: "Alice", amount: 5000 };
    const result = sanitize(input) as Record<string, unknown>;
    expect(result.email).toBe("user@example.com");
    expect(result.name).toBe("Alice");
    expect(result.amount).toBe(5000);
  });

  test("the universal patterns are non-empty (always-on safety net)", () => {
    expect(UNIVERSAL_SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("sanitize — injected redaction policy", () => {
  test("redacts exact domain field names once registered", () => {
    configureRedaction({ fields: ["email", "amount", "fatherName"] });
    const result = sanitize({
      email: "user@example.com",
      amount: 5000,
      fatherName: "John Doe",
    }) as Record<string, unknown>;
    expect(result.email).toBe("[redacted]");
    expect(result.amount).toBe("[redacted]");
    expect(result.fatherName).toBe("[redacted]");
  });

  test("applies extra domain patterns on top of the universal set", () => {
    configureRedaction({ patterns: [/ssn/i] });
    const result = sanitize({ ssn: "111-22-3333", token: "t" }) as Record<
      string,
      unknown
    >;
    expect(result.ssn).toBe("[redacted]");
    // Universal patterns still apply alongside the injected ones.
    expect(result.token).toBe("[redacted]");
  });

  test("field matching is case-insensitive", () => {
    configureRedaction({ fields: ["searchname"] });
    const result = sanitize({ searchName: "Alisa" }) as Record<string, unknown>;
    expect(result.searchName).toBe("[redacted]");
  });
});

describe("sanitize — structural behavior (policy-independent)", () => {
  test("recurses into nested objects", () => {
    const result = sanitize({
      outer: { token: "t", inner: { password: "p", keep: "ok" } },
    }) as Record<string, unknown>;
    const outer = result.outer as Record<string, unknown>;
    expect(outer.token).toBe("[redacted]");
    const inner = outer.inner as Record<string, unknown>;
    expect(inner.password).toBe("[redacted]");
    expect(inner.keep).toBe("ok");
  });

  test("recurses into arrays", () => {
    const result = sanitize([
      { password: "p1", keep: "a" },
      { password: "p2", keep: "b" },
    ]) as Array<Record<string, unknown>>;
    expect(result[0].password).toBe("[redacted]");
    expect(result[0].keep).toBe("a");
    expect(result[1].password).toBe("[redacted]");
  });

  test("passes through non-sensitive fields", () => {
    const result = sanitize({
      code: "CS101",
      path: "/api/courses",
      id: "abc-123",
    }) as Record<string, unknown>;
    expect(result.code).toBe("CS101");
    expect(result.path).toBe("/api/courses");
    expect(result.id).toBe("abc-123");
  });

  test("passes through primitives unchanged", () => {
    expect(sanitize("hello")).toBe("hello");
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
  });

  test("passes through empty objects and arrays", () => {
    expect(sanitize({})).toEqual({});
    expect(sanitize([])).toEqual([]);
  });
});

describe("SyncConcept default logging", () => {
  test("default logging level is OFF", () => {
    const sync = new SyncConcept();
    expect(sync.logging).toBe(Logging.OFF);
  });

  test("logging can be changed to VERBOSE at runtime", () => {
    const sync = new SyncConcept();
    sync.logging = Logging.VERBOSE;
    expect(sync.logging).toBe(Logging.VERBOSE);
  });

  test("logging can be changed to TRACE at runtime", () => {
    const sync = new SyncConcept();
    sync.logging = Logging.TRACE;
    expect(sync.logging).toBe(Logging.TRACE);
  });
});
