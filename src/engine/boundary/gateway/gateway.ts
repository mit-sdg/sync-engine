import { vocabulary } from "@engine/reactions/authoring/refs";
import type { OutcomeContracts } from "@engine/reactions/concepts/outcomes";
import { Refuse } from "@engine/reactions/concepts/refuse";
import type { LogStore, RetentionPolicy } from "@engine/reactions/runtime/log-store";
import { Logging } from "@engine/reactions/runtime/logging";
import { OperationalEvents, type OperationalObserver } from "@engine/reactions/runtime/operational";
import type { Reacting } from "@engine/reactions/runtime/reacting";
import type { Vars } from "@engine/reactions/types";
import type { RedactionPolicy } from "@engine/utils/redaction";
import { admitInput } from "../protocol/admit.ts";
import type { ApplicationInterface } from "../protocol/application-interface.ts";
import type { ContractShape, DomainErrorValue } from "../protocol/contract-shape.ts";
import type { InputContractDecl } from "../protocol/endpoints.ts";
import { FrameworkErrorCode, isEmittedFrameworkErrorCode } from "../protocol/errors.ts";
import type { EmittedFrameworkErrorCode, InvocationResult } from "../protocol/errors.ts";
import { assemble, endpoint, receive, respond } from "../assembly/assemble.ts";
import type { ClientError } from "../client/client.ts";
import type { Invoker } from "../invocation/invoke.ts";
import type { ExecutionLimits } from "../invocation/lifecycle.ts";

const GATEWAY_RECEIVE_PATH = "/gateway/receive";

type GatewayBoundaryContract = {
  "/gateway/receive": {
    input: {
      targetPath: string;
      input: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    };
    output: { reply: Promise<GatewayReply> };
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

  forward({
    path,
    admitted,
    correlationId,
    signal,
    timeoutMs,
  }: {
    path: string;
    admitted: Record<string, unknown>;
    correlationId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): { reply: Promise<GatewayReply> } {
    const reply = Promise.resolve()
      .then(() => this.application.invoke(path, admitted, { correlationId, signal, timeoutMs }))
      .then(
        (result): GatewayReply => {
          if (result.ok) return { kind: "success", body: result.value };
          if (result.error.kind === "framework") {
            return {
              kind: "framework",
              code: result.error.code,
              ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
            };
          }
          return { kind: "domain", value: result.error.value };
        },
        (): GatewayReply => ({
          kind: "framework",
          code: FrameworkErrorCode.TRANSPORT_ERROR,
        }),
      );
    return { reply };
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
  ({ targetPath, input, admitted, reply, correlationId, signal, timeoutMs }: Vars) =>
    receive({ targetPath, input, correlationId, signal, timeoutMs })
      .then(GatewayRouting.resolve({ path: targetPath }))
      .then(GatewayAdmitting.admit({ path: targetPath, input }).responds({ admitted }))
      .then(
        GatewayForwarding.forward({
          path: targetPath,
          admitted,
          correlationId,
          signal,
          timeoutMs,
        }).responds({ reply }),
      )
      .then(respond({ reply })),
);

export interface Gateway<C extends ContractShape> extends Invoker<C> {
  /** The gateway's own engine and log, separate from the application. */
  readonly engine: Reacting;
  readonly publicInterface: ApplicationInterface;
  beginDrain(): Promise<void>;
  whenIdle(): Promise<void>;
}

export interface GatewayOptions {
  application: {
    invoker: Invoker<ContractShape>;
    publicInterface: ApplicationInterface;
    beginDrain?: () => Promise<void>;
    whenIdle?: () => Promise<void>;
  };
  /** Additional gateway reactions, views, and formers. */
  composition?: Record<string, unknown>;
  /** Gateway interpreter diagnostics; defaults to `Logging.OFF`. */
  logging?: Logging;
  /** In-memory gateway occurrence retention; defaults to 100 settled flows. */
  retention?: RetentionPolicy;
  /** Application-owned gateway occurrence store. It cannot be combined with `retention`. */
  logStore?: LogStore;
  /** Opt-in limits for the gateway's own execution. */
  executionLimits?: ExecutionLimits;
  /** Internal gateway events plus one final public-call settlement; bounded synchronous handoff. */
  observers?: readonly OperationalObserver[];
  /** Additional sensitive field names for the gateway only. */
  redaction?: RedactionPolicy;
}

/** Build a separate gateway application in front of an assembled application. */
export function createGateway<C extends ContractShape = ContractShape>(
  options: GatewayOptions,
): Gateway<C> {
  const operational = new OperationalEvents(options.observers);
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
    retention: options.retention,
    logStore: options.logStore,
    executionLimits: options.executionLimits,
    observers:
      options.observers === undefined
        ? undefined
        : [
            (event) => {
              if (event.type !== "invocation-settled") operational.emit(event);
            },
          ],
    redaction: options.redaction,
  });

  return {
    engine: app.engine,
    publicInterface: options.application.publicInterface,
    async beginDrain() {
      await app.beginDrain();
      await options.application.beginDrain?.();
    },
    async whenIdle() {
      await app.whenIdle();
      await options.application.whenIdle?.();
    },
    async invoke(path, input, invokeOptions) {
      const startedAt = performance.now();
      const correlationId = invokeOptions?.correlationId ?? crypto.randomUUID();
      const settle = <T extends InvocationResult>(settled: T): T => {
        operational.emit({
          type: "invocation-settled",
          at: Date.now(),
          route: path,
          correlationId,
          result: settled.ok
            ? "success"
            : settled.error.kind === "domain"
              ? "domain-error"
              : "framework-error",
          ...(!settled.ok && settled.error.kind === "framework"
            ? { frameworkCode: settled.error.code }
            : {}),
          durationMs: performance.now() - startedAt,
        });
        return settled;
      };
      const effectiveOptions = { ...invokeOptions, correlationId };
      const result = (await (app.invoker as Invoker<GatewayBoundaryContract>).invoke(
        GATEWAY_RECEIVE_PATH,
        {
          targetPath: path,
          input,
          signal: effectiveOptions.signal,
          timeoutMs: effectiveOptions.timeoutMs,
        },
        effectiveOptions,
      )) as InvocationResult<{ reply: Promise<GatewayReply> }, string>;

      if (result.ok) {
        const reply = await result.value.reply;
        if (reply.kind === "success") return settle({ ok: true, value: reply.body } as never);
        if (reply.kind === "domain") {
          return settle({ ok: false, error: { kind: "domain", value: reply.value } } as never);
        }
        return settle({
          ok: false,
          error: {
            kind: "framework",
            code: reply.code,
            ...(reply.detail === undefined ? {} : { detail: reply.detail }),
          },
        });
      }
      if (result.error.kind === "domain") {
        if (isEmittedFrameworkErrorCode(result.error.value)) {
          return settle({
            ok: false,
            error: {
              kind: "framework",
              code: result.error.value,
              ...(result.error.value === FrameworkErrorCode.NOT_FOUND
                ? { detail: `Unknown endpoint: ${String(path)}` }
                : {}),
            },
          });
        }
        return settle({
          ok: false,
          error: { kind: "domain", value: result.error.value },
        } as never);
      }
      return settle(
        result as InvocationResult<
          C[typeof path]["output"],
          DomainErrorValue<C[typeof path]["error"]>
        >,
      );
    },
  } as Gateway<C>;
}

/** The raw result shape a client sees after a gateway invocation. */
export type GatewayClientError = ClientError;
