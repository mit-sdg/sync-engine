export interface EndpointDeclaration {
  readonly name: string;
  readonly path: string;
  readonly reactions: readonly string[];
}
