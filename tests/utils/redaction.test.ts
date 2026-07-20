import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { configureRedaction, redact } from "@sync-engine/utils";

beforeEach(() => configureRedaction({ fields: [] }));
afterEach(() => configureRedaction({ fields: [] }));

describe("configured redaction policy", () => {
  test("redacts configured field names and pattern-matched field names", () => {
    configureRedaction({
      fields: ["email", "ssn"],
      patterns: [/credit_card/i],
    });

    const result = redact({
      email: "user@example.com",
      ssn: "123-45-6789",
      credit_card: "4111-1111-1111-1111",
      name: "Alice",
    }) as Record<string, unknown>;

    expect(result.email).toBe("[redacted]");
    expect(result.ssn).toBe("[redacted]");
    expect(result.credit_card).toBe("[redacted]");
    expect(result.name).toBe("Alice");
  });

  test("a later configuration replaces earlier domain fields", () => {
    configureRedaction({ fields: ["email"] });
    configureRedaction({ fields: ["phone"] });
    const result = redact({ email: "visible@example.test", phone: "555-1234" }) as Record<
      string,
      unknown
    >;
    expect(result.email).toBe("visible@example.test");
    expect(result.phone).toBe("[redacted]");
  });

  test("pattern policies match field names", () => {
    configureRedaction({ patterns: [/health_record/i] });
    const result = redact({
      health_record: "confidential",
    }) as Record<string, unknown>;
    expect(result.health_record).toBe("[redacted]");
  });

  test("does not inspect arbitrary string values", () => {
    const value = "mongodb://user:password@example.test/private?token=secret";
    expect(redact({ note: value })).toEqual({ note: value });
  });
});

describe("redact", () => {
  test("circular reference does not stack overflow", () => {
    const a: any = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });

  test("depth > 5 returns [max depth]", () => {
    const obj = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    const result = redact(obj) as any;
    expect(result.a.b.c.d.e.f).toBe("[max depth]");
  });

  test("top-level Error instance keeps only its class", () => {
    const result = redact(new Error("test")) as Record<string, unknown>;
    expect(result).toEqual({ name: "Error" });
  });

  test("Error as object property value keeps only its class", () => {
    const result = redact({ err: new Error("nested") }) as Record<string, unknown>;
    const err = result.err as Record<string, unknown>;
    expect(err).toEqual({ name: "Error" });
  });

  test("BigInt at top level is converted to string", () => {
    expect(redact(42n)).toBe("42");
  });

  test("BigInt as property value passes through as primitive", () => {
    const result = redact({ val: 42n }) as Record<string, unknown>;
    expect(typeof result.val).toBe("bigint");
    expect(result.val).toBe(42n);
  });

  test("configureRedaction with non-iterable fields does not throw", () => {
    expect(() => configureRedaction({ fields: 123 as any })).not.toThrow();
  });
});
