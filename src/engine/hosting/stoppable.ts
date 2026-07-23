/** A long-lived resource that a host can stop during shutdown. */
export interface Stoppable {
  stop(): void | Promise<void>;
}
