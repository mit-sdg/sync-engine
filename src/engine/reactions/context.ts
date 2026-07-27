/** Reserved bindings carried beside application variables in an interpreter frame. */
export const flow = Symbol("flow");
export const actionId = Symbol("actionId");
export const byReaction = Symbol("byReaction");
/** Internal callback through which instrumentation reports how far a consequence ask landed. */
export const actionSettlement = Symbol("actionSettlement");
export type ActionSettlement = "ask-recorded" | "fault-recorded";
export const landing = Symbol("landing");
