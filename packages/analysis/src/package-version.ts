import packageManifest from "../package.json" with { type: "json" };

export const ANALYSIS_PACKAGE_NAME = packageManifest.name;
export const ANALYSIS_PACKAGE_VERSION = packageManifest.version;
export const ANALYSIS_CORE_VERSION = packageManifest.peerDependencies["@mit-sdg/sync-engine"];
