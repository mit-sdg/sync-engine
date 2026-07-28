import packageManifest from "@root/package.json" with { type: "json" };

export const PACKAGE_NAME = packageManifest.name;
export const PACKAGE_VERSION = packageManifest.version;

export interface GeneratorIdentity {
  name: typeof PACKAGE_NAME;
  version: string;
}

export const GENERATOR_IDENTITY: GeneratorIdentity = Object.freeze({
  name: PACKAGE_NAME,
  version: PACKAGE_VERSION,
});

export function assertCurrentGenerator(
  identity: unknown,
  owner: string,
): asserts identity is GeneratorIdentity {
  const candidate = identity as Partial<GeneratorIdentity> | undefined;
  if (candidate?.name !== PACKAGE_NAME || candidate.version !== PACKAGE_VERSION) {
    throw new Error(`${owner}: requires generator ${PACKAGE_NAME}@${PACKAGE_VERSION}.`);
  }
}
