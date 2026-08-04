import type { ContractShape } from "../protocol/types.ts";
import { toJsonEnvelope, toJsonValue } from "../protocol/envelope.ts";
import type { Invoker } from "../invocation/invoke.ts";
import type { Client, ClientResponseValidator } from "./client.ts";
import { createClient } from "./client.ts";

/** Consume an assembled boundary in process through the ordinary client contract. */
export function createLocalClient<C extends ContractShape>(options: {
  invoker: Invoker<C>;
  validateResponse?: ClientResponseValidator;
}): Client<C> {
  return createClient<C>({
    ...(options.validateResponse === undefined
      ? {}
      : { validateResponse: options.validateResponse }),
    transport: async (request) =>
      toJsonEnvelope(
        await options.invoker.invoke(
          request.path as keyof C & string,
          toJsonValue(request.input) as never,
          {
            signal: request.signal,
            timeoutMs: request.timeoutMs,
            correlationId: request.correlationId,
          },
        ),
      ),
  });
}
