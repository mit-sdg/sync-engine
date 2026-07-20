import { afterEach, describe, expect, test } from "vite-plus/test";
import { Logging, Reacting } from "@sync-engine/internal/reactions";
import { configureRedaction, redact, UNIVERSAL_SENSITIVE_PATTERNS } from "@sync-engine/utils";

// The framework owns only the universal credential patterns; domain fields
// (PII, financials) are the app's policy and are tested app-side. Each test
// that registers a policy resets to the universal-only default afterward.
afterEach(() => configureRedaction({ fields: [] }));

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
  test("redacts exact domain field names once registered", () => {
    configureRedaction({ fields: ["email", "amount", "fatherName"] });
    const result = redact({
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
    const result = redact({ ssn: "111-22-3333", token: "t" }) as Record<string, unknown>;
    expect(result.ssn).toBe("[redacted]");
    // Universal patterns apply alongside the injected ones.
    expect(result.token).toBe("[redacted]");
  });

  test("field matching is case-insensitive", () => {
    configureRedaction({ fields: ["searchname"] });
    const result = redact({ searchName: "Alisa" }) as Record<string, unknown>;
    expect(result.searchName).toBe("[redacted]");
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
