/**
 * Hold every concept specification to its class, reading the TypeScript source.
 *
 * Registration makes the same comparison when an application starts, but by
 * then a parameter's type is gone: `end(_: { session: string })` reaches the
 * engine as `end(_)`, and its declared input cannot be recovered. Runtime
 * therefore compares inputs only for a method that destructures them, and
 * stays silent about one that does not.
 *
 * Reading the source recovers what erasure removed. A signature that disagrees
 * with its specification fails here even when the implementation never names
 * its inputs — a placeholder parameter, a plain named parameter, or none at
 * all. Run it from `bun run check`.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { parseSpec, type ConceptSpec } from "../src/engine/reactions/concept-spec.ts";
import { filesBelow } from "./walk.ts";

const root = resolve(import.meta.dirname, "..");

/** Where authored concepts live: any directory below these holding a `spec.md`. */
const conceptRoots = ["examples", "tests/package/application"];

function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** The inputs a signature declares, or `undefined` when the source states none. */
type Inputs = readonly string[] | undefined;

function membersOfTypeLiteral(type: ts.TypeLiteralNode): string[] {
  return type.members.flatMap((member) =>
    ts.isPropertySignature(member) && ts.isIdentifier(member.name) ? [member.name.text] : [],
  );
}

/** Resolve a type reference one level, against the aliases declared in its own file. */
function aliasIn(source: ts.SourceFile, name: string): ts.TypeNode | undefined {
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) return statement.type;
  }
  return undefined;
}

/** `Record<string, never>` and `Record<PropertyKey, never>` describe no inputs. */
function isEmptyRecord(type: ts.TypeReferenceNode): boolean {
  return (
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Record" &&
    type.typeArguments?.length === 2 &&
    type.typeArguments[1].kind === ts.SyntaxKind.NeverKeyword
  );
}

function inputsOfType(type: ts.TypeNode, source: ts.SourceFile, depth = 0): Inputs {
  if (ts.isTypeLiteralNode(type)) return membersOfTypeLiteral(type);
  if (ts.isTypeReferenceNode(type)) {
    if (isEmptyRecord(type)) return [];
    if (depth > 0 || !ts.isIdentifier(type.typeName)) return undefined;
    const aliased = aliasIn(source, type.typeName.text);
    return aliased === undefined ? undefined : inputsOfType(aliased, source, depth + 1);
  }
  return undefined;
}

/**
 * The input names one method declares. The parameter's type is authoritative;
 * a method with no parameter takes nothing; a destructuring pattern without a
 * type names its own inputs.
 */
function inputsOfMethod(method: ts.MethodDeclaration, source: ts.SourceFile): Inputs {
  const [parameter] = method.parameters;
  if (parameter === undefined) return [];
  if (parameter.type !== undefined) return inputsOfType(parameter.type, source);
  if (ts.isObjectBindingPattern(parameter.name)) {
    return parameter.name.elements.flatMap((element) =>
      ts.isIdentifier(element.name) ? [element.name.text] : [],
    );
  }
  return undefined;
}

interface Member {
  name: string;
  inputs: Inputs;
}

/** The public actions and queries a concept class declares, in source order. */
function membersOfClass(declaration: ts.ClassDeclaration, source: ts.SourceFile): Member[] {
  const members: Member[] = [];
  for (const member of declaration.members) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const modifiers = ts.getModifiers(member) ?? [];
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword)) continue;
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword)) continue;
    members.push({ name: member.name.text, inputs: inputsOfMethod(member, source) });
  }
  return members;
}

function classIn(source: ts.SourceFile, name: string): ts.ClassDeclaration | undefined {
  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) return statement;
  }
  return undefined;
}

/** The class name a registry registers, and the module it imports it from. */
function registeredClass(registry: ts.SourceFile): { name: string; from: string } | undefined {
  let name: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "registerConcept" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
        if (property.name.text === "class" && ts.isIdentifier(property.initializer)) {
          name = property.initializer.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(registry);
  if (name === undefined) return undefined;

  for (const statement of registry.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((element) => element.name.text === name)) {
      return { name, from: statement.moduleSpecifier.text };
    }
  }
  return undefined;
}

const listed = (names: readonly string[]): string =>
  names.length === 0 ? "none" : names.map((name) => `\`${name}\``).join(", ");

function compare(
  kind: "action" | "query",
  declarations: readonly { name: string; inputs: readonly string[] }[],
  members: readonly Member[],
  report: (what: string) => void,
): void {
  const declared = declarations.map(({ name }) => name);
  const implemented = members.map(({ name }) => name);

  const missing = declared.filter((name) => !implemented.includes(name));
  if (missing.length > 0) {
    report(`the specification declares the ${kind} ${listed(missing)}, which the class lacks`);
  }
  const unspecified = implemented.filter((name) => !declared.includes(name));
  if (unspecified.length > 0) {
    report(`the class declares the ${kind} ${listed(unspecified)}, which the specification lacks`);
  }
  for (const declaration of declarations) {
    const member = members.find(({ name }) => name === declaration.name);
    // A parameter whose type the source does not state stays unverifiable.
    if (member?.inputs === undefined) continue;
    if ([...declaration.inputs].sort().join() === [...member.inputs].sort().join()) continue;
    report(
      `the ${kind} \`${declaration.name}\` declares the inputs ${listed(declaration.inputs)} ` +
        `but the class takes ${listed(member.inputs)}`,
    );
  }
}

/**
 * Check one concept directory: its `spec.md`, the `registry.ts` naming its
 * class, and the class itself. Answers the findings, most specific first.
 */
export function conceptFailures(directory: string): string[] {
  const within = relative(root, directory);
  const label = within === "" || within.startsWith("..") ? directory : within;
  const findings: string[] = [];
  const report = (what: string): void => void findings.push(`${label}: ${what}.`);

  const registryPath = join(directory, "registry.ts");
  let spec: ConceptSpec;
  try {
    spec = parseSpec(readFileSync(join(directory, "spec.md"), "utf8"));
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    return findings;
  }

  const registered = registeredClass(parseFile(registryPath));
  if (registered === undefined) {
    report("registry.ts does not register a class imported by name");
    return findings;
  }
  const classPath = resolve(dirname(registryPath), registered.from);
  const source = parseFile(classPath);
  const declaration = classIn(source, registered.name);
  if (declaration === undefined) {
    report(`${basename(classPath)} does not declare ${registered.name}`);
    return findings;
  }

  const members = membersOfClass(declaration, source);
  compare(
    "action",
    spec.actions,
    members.filter(({ name }) => !name.startsWith("_")),
    report,
  );
  compare(
    "query",
    spec.queries,
    members.filter(({ name }) => name.startsWith("_")),
    report,
  );
  return findings;
}

/** Every directory below `roots` holding a concept specification. */
export async function conceptDirectories(roots: readonly string[]): Promise<string[]> {
  const found = await Promise.all(
    roots.map((directory) => filesBelow(resolve(root, directory), (name) => name === "spec.md")),
  );
  return found
    .flat()
    .map((path) => dirname(path))
    .sort();
}

if (import.meta.main) {
  const directories = await conceptDirectories(conceptRoots);
  const failures = directories.flatMap((directory) => conceptFailures(directory));
  if (failures.length > 0) {
    throw new Error(
      `Concept specification check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`specification check passed for ${directories.length} concepts`);
}
