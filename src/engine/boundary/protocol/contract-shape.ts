/** The structural shape accepted by typed boundary clients and invokers. */
export type ContractShape = Record<string, { input: unknown; output: unknown; error?: unknown }>;

/** The value carried inside a wire error envelope. */
export type DomainErrorValue<T> = T extends { error: infer E } ? E : T;
