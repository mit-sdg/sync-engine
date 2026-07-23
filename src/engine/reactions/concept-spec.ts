/** Read purpose and principle from their single authored specification. */

/** The prose a concept's specification document authors. */
export interface ConceptSpecProse {
  purpose: string;
  principle: string;
}

function sectionOf(lines: readonly string[], heading: string): string {
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`spec: the document has no "## ${heading}" section.`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const text = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (text === "") {
    throw new Error(`spec: the "## ${heading}" section is empty.`);
  }
  return text;
}

/**
 * Extract the purpose and principle from a concept specification's markdown
 * text (import the document with `{ type: "text" }`). Throws, loudly and by
 * section name, when either is missing or empty.
 */
export function parseSpecProse(markdown: string): ConceptSpecProse {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new Error(
      'spec takes the specification\'s markdown text — import it with { type: "text" }.',
    );
  }
  const lines = markdown.split("\n");
  return {
    purpose: sectionOf(lines, "Purpose"),
    principle: sectionOf(lines, "Principle"),
  };
}
