/** `operations-room` → `OperationsRoom` */
export function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

/** `operations-room` → `operationsRoom` */
export function camel(name: string): string {
  const upper = pascal(name);
  return upper.charAt(0).toLowerCase() + upper.slice(1);
}

/** `operations-room` → `Operations room` */
export function heading(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return name;
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

/** `Operations room` → `operations-room` */
export function slug(headingText: string): string {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
