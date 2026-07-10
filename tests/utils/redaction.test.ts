import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { configureRedaction, redact } from "@sync-engine/utils";

beforeEach(() => configureRedaction({ fields: [] }));
afterEach(() => configureRedaction({ fields: [] }));

describe("configureRedaction updates policy atomically", () => {
  test("should apply both field-based and pattern-based redaction consistently after configuration", () => {
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

    // configureRedaction assigns policyFields and policyPatterns in two
    // separate steps. If redact() runs between those steps, it could read
    // the new fields with the old patterns (or vice versa), producing
    // inconsistent redaction.
  });

  test("field-based policies take effect immediately", () => {
    configureRedaction({ fields: ["phone"] });
    const result = redact({ phone: "555-1234" }) as Record<string, unknown>;
    expect(result.phone).toBe("[redacted]");
  });

  test("pattern-based policies take effect immediately", () => {
    configureRedaction({ patterns: [/health_record/i] });
    const result = redact({
      health_record: "confidential",
    }) as Record<string, unknown>;
    expect(result.health_record).toBe("[redacted]");
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

  test("top-level Error instance returns serialized error", () => {
    const result = redact(new Error("test")) as Record<string, unknown>;
    expect(result.name).toBe("Error");
    expect(result.message).toBe("test");
    expect(typeof result.stack).toBe("string");
  });

  test("Error as object property value is serialized", () => {
    const result = redact({ err: new Error("nested") }) as Record<string, unknown>;
    const err = result.err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("nested");
    expect(typeof err.stack).toBe("string");
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
