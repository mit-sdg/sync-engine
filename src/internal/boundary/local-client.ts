import type { Client, ContractShape } from "./client.ts";
import { createClient } from "./client.ts";
import { toJsonEnvelope, toJsonValue } from "./envelope.ts";
import type { Invoker } from "./invoke.ts";

/** Consume an assembled boundary in process through the ordinary client contract. */
export function createLocalClient<C extends ContractShape>(options: {
  invoker: Invoker<C>;
}): Client<C> {
  return createClient<C>({
    transport: async (request) =>
      toJsonEnvelope(
        await options.invoker.invoke(
          request.path as keyof C & string,
          toJsonValue(request.input) as never,
        ),
      ),
  });
}
