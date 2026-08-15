declare function vocabulary(declaration: object): unknown;

export const declared = vocabulary({ concepts: {}, computations: {} });
export { declared as vocabulary };
