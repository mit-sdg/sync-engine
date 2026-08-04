interface ActionLine {
  done: boolean;
  reservation: WaitingReservation;
  settled: Promise<void>;
}

interface WaitingReservation {
  blockedBy?: WaitingReservation;
  flow: string;
  released: boolean;
  release(): boolean;
}

interface ActionScheduleRequest<Input, Result> {
  concept: object;
  flow: string;
  body(input: Input): Result;
  input: Input;
  onBodySettled?(): void;
}

interface ActionReservation<Result> {
  result: Promise<Result>;
  release(): boolean;
  durationMs(): number;
}

export interface ActionScheduling {
  reserve<Input, Result>(
    request: ActionScheduleRequest<Input, Result>,
  ): ActionReservation<Awaited<Result>>;
}

/** Serializes action bodies independently for each raw concept instance. */
export class ActionScheduler implements ActionScheduling {
  private readonly schedules = new WeakMap<object, ActionLine>();
  private readonly reservations = new Set<WeakRef<WaitingReservation>>();

  private blockerOf(reservation: WaitingReservation | undefined): WaitingReservation | undefined {
    let blocker: WaitingReservation | undefined;
    for (let current = reservation; current !== undefined; current = current.blockedBy) {
      if (!current.released) blocker = current;
    }
    return blocker;
  }

  private cycleBreaker(
    from: string,
    target: string,
    visited = new Set<string>(),
  ): WaitingReservation | undefined {
    if (visited.has(from)) return undefined;
    visited.add(from);
    for (const reference of this.reservations) {
      const reservation = reference.deref();
      if (reservation === undefined) {
        this.reservations.delete(reference);
        continue;
      }
      if (reservation.flow !== from) continue;
      const blocker = this.blockerOf(reservation.blockedBy);
      if (blocker === undefined) continue;
      if (blocker.flow === target) return blocker;
      const nested = this.cycleBreaker(blocker.flow, target, visited);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  reserve<Input, Result>({
    concept,
    flow,
    body,
    input,
    onBodySettled,
  }: ActionScheduleRequest<Input, Result>): ActionReservation<Awaited<Result>> {
    for (const reference of this.reservations) {
      if (reference.deref() === undefined) this.reservations.delete(reference);
    }
    const prior = this.schedules.get(concept);
    for (let earlier = prior?.reservation; earlier !== undefined; earlier = earlier.blockedBy) {
      if (earlier.flow === flow && !earlier.released) earlier.release();
    }
    let blockedBy = this.blockerOf(prior?.reservation);
    const breaker =
      blockedBy?.flow === flow
        ? blockedBy
        : blockedBy === undefined
          ? undefined
          : this.cycleBreaker(blockedBy.flow, flow);
    breaker?.release();
    blockedBy = this.blockerOf(prior?.reservation);

    const {
      promise: result,
      resolve: resolveRun,
      reject: rejectRun,
    } = Promise.withResolvers<Awaited<Result>>();
    let predecessorDone = prior?.done ?? true;
    let released = false;
    let bodyStarted = false;
    let started: number | undefined;
    let line: ActionLine;

    const settle = (outcome: "resolve" | "reject", value: unknown): void => {
      line.done = true;
      try {
        onBodySettled?.();
        if (outcome === "resolve") resolveRun(value as Awaited<Result>);
        else rejectRun(value);
      } catch (error) {
        rejectRun(error);
      }
    };
    const startBody = (): void => {
      if (!released || !predecessorDone || bodyStarted) return;
      bodyStarted = true;
      started ??= performance.now();
      try {
        const bodyResult = body(input);
        const promise = normalizePromiseLike(bodyResult);
        if (promise !== undefined) {
          void promise.then(
            (output) => settle("resolve", output),
            (error) => settle("reject", error),
          );
        } else settle("resolve", bodyResult);
      } catch (error) {
        settle("reject", error);
      }
    };
    const reservation: WaitingReservation = {
      ...(blockedBy === undefined ? {} : { blockedBy }),
      flow,
      released,
      release: () => {
        if (released) return false;
        released = true;
        reservation.released = true;
        started ??= performance.now();
        if (prior?.done === true) predecessorDone = true;
        startBody();
        return true;
      },
    };
    const reference = new WeakRef(reservation);
    this.reservations.add(reference);

    if (prior !== undefined && !prior.done) {
      void prior.settled.then(() => {
        predecessorDone = true;
        startBody();
      });
    }
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    line = { done: false, reservation, settled: tail };
    this.schedules.set(concept, line);
    void tail.then(() => {
      this.reservations.delete(reference);
      if (this.schedules.get(concept) === line) this.schedules.delete(concept);
    });

    return {
      result,
      release: reservation.release,
      durationMs: () => (started === undefined ? 0 : performance.now() - started),
    };
  }

  /** Whether the concept has no reserved or running action body. */
  isIdle(concept: object): boolean {
    return !this.schedules.has(concept);
  }
}
import { normalizePromiseLike } from "@engine/utils/promise-like";
