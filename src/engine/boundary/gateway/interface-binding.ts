import type { Assembly } from "../assembly/assembly-facade.ts";
import { assemblyBehind } from "../assembly/assembly-registry.ts";
import type {
  AssembledInterfaceDeclaration,
  InterfaceDefinition,
} from "../protocol/interface-definition.ts";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

export interface InterfaceBinding {
  readonly identity: string;
  readonly members: readonly AssembledInterfaceDeclaration[];
  readonly dependencies: Readonly<Record<string, readonly AssembledInterfaceDeclaration[]>>;
  readonly declarations: Readonly<Record<string, AssembledInterfaceDeclaration>>;
}

/** Bind one named interface to the assembly that canonically admitted it. */
export function bindInterface(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
}): InterfaceBinding {
  const assembled = assemblyBehind(options.system);
  const definition = assembled.interfaces.definitions.find(
    (candidate) => candidate.definition === options.interface,
  );
  if (definition === undefined) {
    throw new Error("bindInterface: interface must belong to the supplied system.");
  }

  const declaration = (identity: string): AssembledInterfaceDeclaration => {
    const selected = assembled.interfaces.declarations[identity];
    if (selected === undefined) {
      throw new Error(
        `bindInterface: assembled interface ${JSON.stringify(definition.identity)} refers to missing declaration ${JSON.stringify(identity)}.`,
      );
    }
    return selected;
  };

  return Object.freeze({
    identity: definition.identity,
    members: Object.freeze(definition.members.map(declaration)),
    dependencies: Object.freeze(
      Object.fromEntries(
        Object.entries(definition.dependencies).map(([member, identities]) => [
          member,
          Object.freeze(identities.map(declaration)),
        ]),
      ),
    ),
    declarations: assembled.interfaces.declarations,
  });
}
