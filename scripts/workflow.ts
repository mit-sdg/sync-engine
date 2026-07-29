/** Small YAML-text facts shared by repository policy checks. */

export function activeWorkflowSource(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

/** Every action `uses:` value, including local actions. */
export function workflowUses(source: string): string[] {
  return [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((match) => match[1] ?? "");
}

/** Parse non-local `owner/action@reference` uses values once. */
export function externalWorkflowActions(
  source: string,
): Array<{ use: string; action: string; reference: string }> {
  return workflowUses(source)
    .filter((use) => !use.startsWith("./"))
    .map((use) => {
      const separator = use.lastIndexOf("@");
      return {
        use,
        action: separator < 0 ? use : use.slice(0, separator),
        reference: separator < 0 ? "" : use.slice(separator + 1),
      };
    });
}
