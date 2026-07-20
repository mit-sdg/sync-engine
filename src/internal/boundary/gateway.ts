import {
  request,
  Logging,
  Refuse,
  type OutcomeContracts,
  type Reacting,
  type Vars,
  vocabulary,
} from "../reactions/index.ts";
import { admitInput } from "./admit.ts";
import type { ApplicationInterface } from "./application-interface.ts";
import { assemble, endpoint, receive, respond } from "./assemble.ts";
import type { ClientError, ContractShape, DomainErrorValue } from "./client.ts";
import type { InputContractDecl } from "./endpoints.ts";
import { FrameworkErrorCode } from "./errors.ts";
import type { EmittedFrameworkErrorCode, InvocationResult } from "./errors.ts";
import type { Invoker } from "./invoke.ts";

const GATEWAY_RECEIVE_PATH = "/gateway/receive";

type GatewayBoundaryContract = {
  "/gateway/receive": {
    input: { targetPath: string; input: unknown };
    output: { reply: GatewayReply };
    error: { error: string };
  };
};

type GatewayReply =
  | { kind: "success"; body: unknown }
  | { kind: "domain"; value: unknown }
  | { kind: "framework"; code: EmittedFrameworkErrorCode; detail?: string };

/** Resolving decides whether an outside path belongs to the application. */
export class GatewayRoutingConcept {
  static readonly purpose =
    "Resolve an outside path against an application's public routes so only known requests cross into it.";

  static readonly principle =
    "A request for a declared path resolves to that path. A request for any other path is refused before the application receives it.";

  static readonly outcomes: OutcomeContracts = {
    resolve: { refusals: [FrameworkErrorCode.NOT_FOUND] },
  };

  constructor(private readonly application: ApplicationInterface) {}

  resolve({ path }: { path: string }): { path: string } {
    if (!(path in this.application.routes)) throw new Refuse(FrameworkErrorCode.NOT_FOUND);
    return { path };
  }
}

/** Admitting checks and normalizes the outer request shape promised to the application. */
export class GatewayAdmittingConcept {
  static readonly purpose =
    "Admit only object-shaped inputs carrying their route's required keys, filling declared defaults before forwarding.";

  static readonly principle =
    "A body with every required key is admitted with its defaults filled. A scalar body or a body missing a required key is refused.";

  static readonly outcomes: OutcomeContracts = {
    admit: { refusals: [FrameworkErrorCode.INVALID_INPUT] },
  };

  constructor(private readonly application: ApplicationInterface) {}

  admit({ path, input }: { path: string; input: unknown }): { admitted: Record<string, unknown> } {
    const contract: InputContractDecl = this.application.routes[path] ?? {};
    const admitted = admitInput(contract, path, input);
    if (!admitted.ok) {
      throw new Refuse(FrameworkErrorCode.INVALID_INPUT, { detail: admitted.detail });
    }
    return { admitted: admitted.admitted };
  }
}

/** Forwarding invokes an admitted application request once. */
export class GatewayForwardingConcept {
  static readonly purpose =
    "Forward an admitted request to the application and carry its answer back across the gateway boundary.";

  static readonly principle =
    "An admitted request is invoked once, and the gateway returns its public answer unchanged.";

  constructor(private readonly application: Invoker<ContractShape>) {}

  async forward({
    path,
    admitted,
    correlationId,
  }: {
    path: string;
    admitted: Record<string, unknown>;
    correlationId: string;
  }): Promise<{ reply: GatewayReply }> {
    const result = await this.application.invoke(path, admitted, { correlationId });
    if (result.ok) return { reply: { kind: "success", body: result.value } };

    if (result.error.kind === "framework") {
      return {
        reply: {
          kind: "framework",
          code: result.error.code,
          ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
        },
      };
    }

    return { reply: { kind: "domain", value: result.error.value } };
  }
}

export const gatewayVocabulary = vocabulary({
  concepts: {
    GatewayRouting: GatewayRoutingConcept,
    GatewayAdmitting: GatewayAdmittingConcept,
    GatewayForwarding: GatewayForwardingConcept,
  },
  computations: {},
});

const { GatewayRouting, GatewayAdmitting, GatewayForwarding } = gatewayVocabulary.concepts;

/**
 * The standard gateway lifecycle, authored as an ordinary endpoint chain.
 * The outer transport calls this one stable endpoint with the requested
 * application path carried as data.
 */
export const ReceiveApplicationRequest = endpoint(
  GATEWAY_RECEIVE_PATH,
  ({ targetPath, input, admitted, reply, correlationId }: Vars) =>
    receive({ targetPath, input, correlationId }).then(
      request(GatewayRouting.resolve, { path: targetPath }),
      request(GatewayAdmitting.admit, { path: targetPath, input }, { admitted }),
      request(GatewayForwarding.forward, { path: targetPath, admitted, correlationId }, { reply }),
      respond({ reply }),
    ),
);

export interface Gateway<C extends ContractShape> extends Invoker<C> {
  /** The gateway's own engine and log, separate from the application. */
  readonly engine: Reacting;
  readonly publicInterface: ApplicationInterface;
}

export interface GatewayOptions {
  application: {
    invoker: Invoker<ContractShape>;
    publicInterface: ApplicationInterface;
  };
  /** Additional gateway reactions, views, and formers. */
  composition?: Record<string, unknown>;
  logging?: Logging;
}

/** Build a separate gateway application in front of an assembled application. */
export function createGateway<C extends ContractShape = ContractShape>(
  options: GatewayOptions,
): Gateway<C> {
  const app = assemble({
    vocabulary: gatewayVocabulary,
    instances: {
      GatewayRouting: new GatewayRoutingConcept(options.application.publicInterface),
      GatewayAdmitting: new GatewayAdmittingConcept(options.application.publicInterface),
      GatewayForwarding: new GatewayForwardingConcept(options.application.invoker),
    },
    composition: {
      Standard: { ReceiveApplicationRequest },
      ...options.composition,
    },
    logging: options.logging,
  });

  return {
    engine: app.engine,
    publicInterface: options.application.publicInterface,
    async invoke(path, input, invokeOptions) {
      const result = (await (app.invoker as Invoker<GatewayBoundaryContract>).invoke(
        GATEWAY_RECEIVE_PATH,
        { targetPath: path, input },
        invokeOptions,
      )) as InvocationResult<{ reply: GatewayReply }, string>;

      if (result.ok) {
        const reply = result.value.reply;
        if (reply.kind === "success") return { ok: true, value: reply.body } as never;
        if (reply.kind === "domain") {
          return { ok: false, error: { kind: "domain", value: reply.value } } as never;
        }
        return {
          ok: false,
          error: {
            kind: "framework",
            code: reply.code,
            ...(reply.detail === undefined ? {} : { detail: reply.detail }),
          },
        };
      }
      if (result.error.kind === "domain") {
        if (isEmittedFrameworkCode(result.error.value)) {
          return {
            ok: false,
            error: {
              kind: "framework",
              code: result.error.value,
              ...(result.error.value === FrameworkErrorCode.NOT_FOUND
                ? { detail: `Unknown endpoint: ${String(path)}` }
                : {}),
            },
          };
        }
        return { ok: false, error: { kind: "domain", value: result.error.value } } as never;
      }
      return result as InvocationResult<
        C[typeof path]["output"],
        DomainErrorValue<C[typeof path]["error"]>
      >;
    },
  } as Gateway<C>;
}

function isEmittedFrameworkCode(value: unknown): value is EmittedFrameworkErrorCode {
  return (
    typeof value === "string" &&
    (Object.values(FrameworkErrorCode) as readonly string[]).includes(value)
  );
}

/** The raw result shape a client sees after a gateway invocation. */
export type GatewayClientError = ClientError;
