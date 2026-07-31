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

export function isStableSemVer(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

export function assertCompatibleGenerator(
  identity: unknown,
  owner: string,
): asserts identity is GeneratorIdentity {
  const candidate = identity as Partial<GeneratorIdentity> | undefined;
  const version = candidate?.version;
  if (candidate?.name !== PACKAGE_NAME || !isStableSemVer(version) || !version.startsWith("1.")) {
    throw new Error(`${owner}: requires a stable 1.x ${PACKAGE_NAME} generator identity.`);
  }
}
