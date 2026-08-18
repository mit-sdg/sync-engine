export interface EndpointDeclaration {
  readonly name: string;
  readonly path: string;
  readonly match?: "prefix";
  readonly reactions: readonly string[];
}
