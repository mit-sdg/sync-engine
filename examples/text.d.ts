/**
 * Characterize `*.md` imports as string-typed for the `with { type: "text" }`
 * import attribute used by concept registries. Each registry imports its
 * `spec.md` this way so the engine can project the concept's Purpose and
 * Principle into generated read-backs.
 */
declare module "*.md" {
  const markdown: string;
  export default markdown;
}
