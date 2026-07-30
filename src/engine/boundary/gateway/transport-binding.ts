import type { Assembly } from "../assembly/assembly-facade.ts";
import { assemblyBehind } from "../assembly/assembly-registry.ts";
import type { InputContractDecl } from "../protocol/endpoints.ts";
import { applicationBehindGateway } from "../protocol/gateway-registry.ts";
import type { ContractShape } from "../protocol/types.ts";
import type { Invoker, InvokeOptions } from "../invocation/invoke.ts";
import { wireContracts, type WireContractsIR } from "../wire/wire-contracts.ts";
import type { Gateway } from "./gateway.ts";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

type Immutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly Immutable<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;

/** Immutable application facts a generated transport projection may inspect. */
export interface WireProjectionFacts {
  readonly routes: Immutable<Readonly<Record<string, InputContractDecl>>>;
  readonly logicalWire: Immutable<WireContractsIR>;
}

/** A verified server-adapter capability with no access to assembly internals. */
export interface TransportBinding<
  C extends ContractShape = ContractShape,
> extends WireProjectionFacts {
  readonly invoker: Invoker<C>;
}

function freeze<T>(value: T): Immutable<T> {
  if (value === null || typeof value !== "object") return value as Immutable<T>;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value) as Immutable<T>;
}

function copy<T>(value: T): Immutable<T> {
  return freeze(structuredClone(value));
}

export function wireProjectionFacts(
  application: AnyAssembly,
  logicalWire?: WireContractsIR,
): WireProjectionFacts {
  const assembled = assemblyBehind(application);
  return Object.freeze({
    routes: copy(assembled.publicInterface.routes),
    logicalWire: copy(
      logicalWire ??
        wireContracts(assembled.engine.exportReactions(), {
          contracts: assembled.contracts,
          inventories: assembled.engine.exportConcepts(),
        }),
    ),
  });
}

/** Bind one gateway to its owning application for a transport adapter. */
export function bindTransport<C extends ContractShape = ContractShape>(options: {
  application: AnyAssembly;
  gateway: Gateway<C>;
}): TransportBinding<C> {
  if (applicationBehindGateway(options.gateway) !== options.application) {
    throw new Error("bindTransport: gateway must target the supplied application.");
  }
  const facts = wireProjectionFacts(options.application);
  const invoker: Invoker<C> = Object.freeze({
    invoke<P extends keyof C & string>(
      path: P,
      input: C[P]["input"],
      invokeOptions?: InvokeOptions,
    ) {
      return options.gateway.invoke(path, input, invokeOptions);
    },
  });
  return Object.freeze({ ...facts, invoker });
}
