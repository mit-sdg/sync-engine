import { afterEach, describe, expect, test } from "vite-plus/test";
import { configureRedaction, redact } from "@sync-engine/utils/redaction.ts";

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
