import type { UnloweredIR } from "@engine/reads/ir";

export interface EndpointIdentity {
  readonly name: string;
  readonly path: string;
}

export interface UnsupportedEndpoint extends EndpointIdentity {
  readonly reaction: string;
  readonly reason: string;
}

export function unsupportedEndpoints(
  unlowered: readonly UnloweredIR[],
  endpointOfReaction: ReadonlyMap<string, EndpointIdentity>,
): UnsupportedEndpoint[] {
  return unlowered.flatMap(({ name: reaction, reason }) => {
    const endpoint = endpointOfReaction.get(reaction);
    return endpoint === undefined ? [] : [{ ...endpoint, reaction, reason }];
  });
}

export function assertPortableEndpoints(
  owner: string,
  unlowered: readonly UnloweredIR[],
  endpointOfReaction: ReadonlyMap<string, EndpointIdentity>,
): void {
  const unsupported = unsupportedEndpoints(unlowered, endpointOfReaction);
  if (unsupported.length === 0) return;

  const details = unsupported
    .map(
      ({ name, path, reaction, reason }) =>
        `- endpoint "${name}" at "${path}" (reaction "${reaction}"): ${reason}`,
    )
    .join("\n");
  throw new Error(
    `${owner}: executable endpoints could not be lowered to complete wire contracts:\n${details}`,
  );
}
