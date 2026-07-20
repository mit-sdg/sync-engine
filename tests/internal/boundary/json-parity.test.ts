import { describe, expect, test } from "vite-plus/test";
import { createHttpHandler, createLocalClient } from "@sync-engine/internal/boundary";

type JsonApi = {
  "/dated": {
    input: { at: string; nested: { kept: string } };
    output: {
      at: string;
      nested: { editedAt: string | null };
      history: string[];
    };
  };
};

describe("boundary JSON parity", () => {
  test("local and HTTP clients return the same JSON projection", async () => {
    const at = new Date("2026-07-17T12:00:00.000Z");
    const inputs: unknown[] = [];
    const raw = {
      at,
      nested: { editedAt: null, omitted: undefined },
      history: [at],
      omitted: undefined,
    };
    const invoker = {
      invoke: async (_path: string, input: unknown) => {
        inputs.push(input);
        return { ok: true as const, value: raw };
      },
    } as never;

    const local = createLocalClient<JsonApi>({ invoker });
    const handler = createHttpHandler({ invoker });
    const request = { at, nested: { kept: "yes", omitted: undefined } };
    const localResult = await local["/dated"](request as never);
    const httpResponse = await handler(
      new Request("http://localhost/dated", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    );

    expect(inputs).toEqual([
      { at: "2026-07-17T12:00:00.000Z", nested: { kept: "yes" } },
      { at: "2026-07-17T12:00:00.000Z", nested: { kept: "yes" } },
    ]);
    expect(localResult).toEqual(await httpResponse.json());
    expect(localResult).toEqual({
      at: "2026-07-17T12:00:00.000Z",
      nested: { editedAt: null },
      history: ["2026-07-17T12:00:00.000Z"],
    });
  });
});
