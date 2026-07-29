interface ActionLine {
  done: boolean;
  settled: Promise<void>;
}

interface WaitingReservation {
  flow: string;
  release(): boolean;
}

interface ConceptSchedule {
  line?: ActionLine;
  waiting: Set<WaitingReservation>;
}

export interface ActionScheduleRequest<Input, Result> {
  concept: object;
  flow: string;
  body(input: Input): Result;
  input: Input;
  onBodySettled?(): void;
}

export interface ActionReservation<Result> {
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
  private readonly schedules = new WeakMap<object, ConceptSchedule>();

  reserve<Input, Result>({
    concept,
    flow,
    body,
    input,
    onBodySettled,
  }: ActionScheduleRequest<Input, Result>): ActionReservation<Awaited<Result>> {
    let schedule = this.schedules.get(concept);
    if (schedule === undefined) {
      schedule = { waiting: new Set() };
      this.schedules.set(concept, schedule);
    }

    // A same-flow consequence cannot wait behind the body whose requested
    // reaction is awaiting it. Release only that flow's earlier slots; other
    // flows still own their release after their requested reactions finish.
    const earlierReservations = [...schedule.waiting];
    if (earlierReservations.some((entry) => entry.flow === flow)) {
      for (const entry of earlierReservations) {
        if (entry.flow === flow) entry.release();
      }
    }

    let resolveRun = (_value: Awaited<Result> | PromiseLike<Awaited<Result>>): void => {};
    let rejectRun = (_error: unknown): void => {};
    const result = new Promise<Awaited<Result>>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    const prior = schedule.line;
    let predecessorDone = prior?.done ?? true;
    let released = false;
    let bodyStarted = false;
    let started: number | undefined;
    let line: ActionLine;

    const settle = (outcome: "resolve" | "reject", value: unknown): void => {
      try {
        onBodySettled?.();
      } catch (error) {
        line.done = true;
        rejectRun(error);
        return;
      }
      line.done = true;
      if (outcome === "resolve") {
        resolveRun(value as Awaited<Result>);
      } else {
        rejectRun(value);
      }
    };
    const startBody = (): void => {
      if (!released || !predecessorDone || bodyStarted) return;
      bodyStarted = true;
      started ??= performance.now();
      try {
        const bodyResult = body(input);
        if (bodyResult instanceof Promise) {
          void bodyResult.then(
            (output) => settle("resolve", output),
            (error) => settle("reject", error),
          );
        } else {
          settle("resolve", bodyResult);
        }
      } catch (error) {
        settle("reject", error);
      }
    };
    const reservation: WaitingReservation = {
      flow,
      release: () => {
        if (released) return false;
        released = true;
        started ??= performance.now();
        schedule.waiting.delete(reservation);
        if (prior?.done === true) predecessorDone = true;
        startBody();
        return true;
      },
    };
    schedule.waiting.add(reservation);

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
    line = { done: false, settled: tail };
    schedule.line = line;
    void tail.then(() => {
      if (schedule.line !== line) return;
      schedule.line = undefined;
      if (schedule.waiting.size === 0 && this.schedules.get(concept) === schedule) {
        this.schedules.delete(concept);
      }
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
