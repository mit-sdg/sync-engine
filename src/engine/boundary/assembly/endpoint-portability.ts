export interface EndpointIdentity {
  readonly name: string;
  readonly path: string;
}

export interface EndpointDeclaration extends EndpointIdentity {
  readonly reactions: readonly string[];
}
