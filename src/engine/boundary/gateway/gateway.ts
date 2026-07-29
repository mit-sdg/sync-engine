import { OperationalEvents, type OperationalObserver } from "@engine/reactions/runtime/operational";
import { admitInput } from "../protocol/admit.ts";
import type { ApplicationInterface } from "../protocol/application-interface.ts";
import type { ContractShape } from "../protocol/contract-shape.ts";
import {
  applicationBehindInvoker,
  rememberGatewayApplication,
} from "../protocol/gateway-registry.ts";
import {
  FrameworkErrorCode,
  type EmittedFrameworkErrorCode,
  type InvocationResult,
} from "../protocol/errors.ts";
import { toJsonValue } from "../protocol/envelope.ts";
import type { Invoker, InvokeOptions } from "../invocation/invoke.ts";
import { RuntimeLifecycle, type ExecutionLimits } from "../invocation/lifecycle.ts";

type GatewayResult = InvocationResult<unknown, unknown>;

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface GatewayTarget {
  invoker: Invoker<ContractShape>;
  publicInterface: ApplicationInterface;
  beginDrain?: () => Promise<void>;
  whenIdle?: () => Promise<void>;
}

export interface GatewayOptions {
  application: GatewayTarget;
  /** Opt-in limits for the gateway's own execution. */
  executionLimits?: ExecutionLimits;
  /** Gateway admission, drain, and final invocation settlement events. */
  observers?: readonly OperationalObserver[];
}

export interface Gateway<C extends ContractShape> extends Invoker<C> {
  beginDrain(): Promise<void>;
  whenIdle(): Promise<void>;
}

function frameworkFailure(code: EmittedFrameworkErrorCode, detail?: string): GatewayResult {
  return {
    ok: false,
    error: {
      kind: "framework",
      code,
      ...(detail === undefined ? {} : { detail }),
    },
  };
}

function projectResult(result: GatewayResult): GatewayResult {
  try {
    if (result.ok) return { ok: true, value: toJsonValue(result.value) };
    if (result.error.kind === "domain") {
      return {
        ok: false,
        error: { kind: "domain", value: toJsonValue(result.error.value) },
      };
    }
    return result;
  } catch {
    return frameworkFailure(FrameworkErrorCode.INTERNAL_ERROR);
  }
}

function waitForInvocation(
  invocation: Promise<GatewayResult>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: GatewayResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish(frameworkFailure(FrameworkErrorCode.ABORTED));
    const timeout = setTimeout(
      () => finish(frameworkFailure(FrameworkErrorCode.TIMED_OUT)),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (isAborted(signal)) abort();
    void invocation.then(finish);
  });
}

/** Decorate an application invoker with transport-neutral gateway policy and lifecycle. */
export function createGateway<C extends ContractShape = ContractShape>(
  options: GatewayOptions,
): Gateway<C> {
  const operational = new OperationalEvents(options.observers);
  const lifecycle = new RuntimeLifecycle(options.executionLimits, operational);
  const { application } = options;
  const registeredApplication = applicationBehindInvoker(application.invoker);
  if (
    registeredApplication !== undefined &&
    registeredApplication.publicInterface !== application.publicInterface
  ) {
    throw new Error("createGateway: application publicInterface must belong to its invoker.");
  }

  const gateway: Gateway<C> = {
    async beginDrain() {
      await lifecycle.beginDrain();
      await application.beginDrain?.();
    },
    async whenIdle() {
      await lifecycle.whenIdle();
      await application.whenIdle?.();
    },
    async invoke(path, input, invokeOptions: InvokeOptions = {}) {
      const startedAt = performance.now();
      const correlationId = invokeOptions.correlationId ?? crypto.randomUUID();
      const settle = (result: GatewayResult): GatewayResult => {
        operational.emit({
          type: "invocation-settled",
          at: Date.now(),
          route: path,
          correlationId,
          result: result.ok
            ? "success"
            : result.error.kind === "domain"
              ? "domain-error"
              : "framework-error",
          ...(!result.ok && result.error.kind === "framework"
            ? { frameworkCode: result.error.code }
            : {}),
          durationMs: performance.now() - startedAt,
        });
        return result;
      };

      if (isAborted(invokeOptions.signal)) {
        return settle(frameworkFailure(FrameworkErrorCode.ABORTED)) as never;
      }

      const timeoutMs =
        invokeOptions.timeoutMs ?? options.executionLimits?.maxRequestDurationMs ?? 30_000;
      const timeoutError = lifecycle.validateTimeout(timeoutMs);
      if (timeoutError !== undefined) {
        return settle(frameworkFailure(FrameworkErrorCode.INVALID_INPUT, timeoutError)) as never;
      }

      const flow = crypto.randomUUID();
      const rejection = lifecycle.admit(flow, path, correlationId);
      if (rejection !== undefined) {
        return settle(frameworkFailure(FrameworkErrorCode.UNAVAILABLE)) as never;
      }

      let invocation: Promise<GatewayResult> | undefined;
      let result: GatewayResult;
      try {
        if (!Object.hasOwn(application.publicInterface.routes, path)) {
          result = frameworkFailure(
            FrameworkErrorCode.NOT_FOUND,
            `Unknown endpoint: ${String(path)}`,
          );
        } else {
          const admission = admitInput(application.publicInterface.routes[path] ?? {}, path, input);
          if (!admission.ok) {
            result = frameworkFailure(FrameworkErrorCode.INVALID_INPUT);
          } else if (isAborted(invokeOptions.signal)) {
            result = frameworkFailure(FrameworkErrorCode.ABORTED);
          } else {
            try {
              invocation = Promise.resolve(
                application.invoker.invoke(path, admission.admitted, {
                  ...invokeOptions,
                  correlationId,
                }),
              ).then(
                (settled) => settled as GatewayResult,
                () => frameworkFailure(FrameworkErrorCode.TRANSPORT_ERROR),
              );
            } catch {
              invocation = Promise.resolve(frameworkFailure(FrameworkErrorCode.TRANSPORT_ERROR));
            }
            const tracked = invocation.finally(() => lifecycle.flowSettled(flow));
            result = await waitForInvocation(tracked, timeoutMs, invokeOptions.signal);
          }
        }
      } catch {
        result = frameworkFailure(FrameworkErrorCode.TRANSPORT_ERROR);
      } finally {
        lifecycle.pendingSettled(flow);
        if (invocation === undefined) lifecycle.flowSettled(flow);
      }

      return settle(projectResult(result)) as never;
    },
  };
  if (registeredApplication !== undefined) {
    rememberGatewayApplication(gateway, registeredApplication);
  }
  return gateway;
}
