import { brand, hasBrand } from "@engine/reads/brands";

const InterfaceDefinitionBrand: unique symbol = Symbol("InterfaceDefinitionBrand");
const InterfaceDeclarationInstaller = Symbol.for(
  "@mit-sdg/sync-engine/interface-declaration-installer/v1",
);

type DeclarationValue = object | ((...args: never[]) => unknown);

export interface InterfaceDefinition<
  Members extends Readonly<Record<string, DeclarationValue>> = Readonly<
    Record<string, DeclarationValue>
  >,
> {
  readonly members: Members;
}

/** Select the canonically exported declarations one participant may use. */
export function defineInterface<Members extends Readonly<Record<string, DeclarationValue>>>(
  members: Members,
): InterfaceDefinition<Members> {
  for (const [name, declaration] of Object.entries(members)) {
    if (
      declaration === null ||
      (typeof declaration !== "object" && typeof declaration !== "function")
    ) {
      throw new TypeError(
        `defineInterface: member ${JSON.stringify(name)} must be an authored declaration value.`,
      );
    }
  }
  const definition = { members: Object.freeze({ ...members }) } as InterfaceDefinition<Members>;
  brand(definition, InterfaceDefinitionBrand);
  return Object.freeze(definition);
}

export function isInterfaceDefinition(value: unknown): value is InterfaceDefinition {
  return hasBrand(value, InterfaceDefinitionBrand);
}

interface IdentityAwareDeclaration {
  readonly [InterfaceDeclarationInstaller]?: (identity: string) => void;
}

/** First-party declaration floors use this hook; application authors use their declaration helper. */
export function interfaceDeclaration<T extends DeclarationValue>(
  value: T,
  installIdentity: (identity: string) => void,
): T {
  Object.defineProperty(value, InterfaceDeclarationInstaller, {
    value: installIdentity,
    enumerable: false,
  });
  return value;
}

export function installInterfaceDeclarationIdentity(
  value: DeclarationValue,
  identity: string,
): void {
  const install = (value as IdentityAwareDeclaration)[InterfaceDeclarationInstaller];
  install?.(identity);
}

export interface AssembledInterfaceDeclaration {
  readonly identity: string;
  readonly value: DeclarationValue;
  readonly kind: "endpoint" | "declaration";
}

export interface AssembledInterfaceDefinition {
  readonly identity: string;
  readonly definition: InterfaceDefinition;
  readonly members: readonly string[];
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
}

export interface AssembledInterfaces {
  readonly declarations: Readonly<Record<string, AssembledInterfaceDeclaration>>;
  readonly definitions: readonly AssembledInterfaceDefinition[];
}
