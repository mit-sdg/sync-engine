import { describe, expect, test } from "vite-plus/test";
import { assemble } from "@sync-engine/assembly";
import { bindTransport, createGateway, endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/advanced";
import { applicationManifest } from "@sync-engine/tooling";

function application() {
  const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
  return assemble({
    vocabulary: vocabulary({ concepts: {}, computations: {} }),
    composition: { Ping },
  });
}

describe("transport binding", () => {
  test("exposes a frozen route and logical-wire snapshot through a narrowed invoker", async () => {
    const assembled = application();
    const gateway = createGateway({ application: assembled });
    const binding = bindTransport({ application: assembled, gateway });

    expect(binding.logicalWire).toEqual(applicationManifest(assembled).wire);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.routes)).toBe(true);
    expect(Object.isFrozen(binding.logicalWire)).toBe(true);
    expect("beginDrain" in binding.invoker).toBe(false);
    await expect(binding.invoker.invoke("/ping", {})).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  test("rejects a gateway for another application", () => {
    const first = application();
    const second = application();

    expect(() =>
      bindTransport({ application: first, gateway: createGateway({ application: second }) }),
    ).toThrow("bindTransport: gateway must target the supplied application.");
  });
});
