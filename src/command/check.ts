import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { parseSpec, type ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { applicationManifest } from "@engine/tooling/manifest";
import { diagnosticsFail } from "@engine/tooling/diagnostics";
import { inspectGenerated, resolveApplication } from "@engine/tooling/generated-artifacts";
import type { GeneratedApplication } from "@engine/tooling/generated-artifacts";

async function filesBelow(
  directory: string,
  filter?: (name: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(path, filter);
      return entry.isFile() && (filter === undefined || filter(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

type Inputs = readonly string[] | undefined;

function membersOfTypeLiteral(type: ts.TypeLiteralNode): Inputs {
  const members: string[] = [];
  for (const member of type.members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) return undefined;
    members.push(member.name.text);
  }
  return members;
}

function aliasIn(source: ts.SourceFile, name: string): ts.TypeNode | undefined {
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) return statement.type;
  }
  return undefined;
}

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

function inputsOfMethod(method: ts.MethodDeclaration, source: ts.SourceFile): Inputs {
  if (method.parameters.length > 1) return undefined;
  const [parameter] = method.parameters;
  if (parameter === undefined) return [];
  if (parameter.type !== undefined) return inputsOfType(parameter.type, source);
  if (ts.isObjectBindingPattern(parameter.name)) {
    const inputs: string[] = [];
    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) return undefined;
      if (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName)) {
        return undefined;
      }
      inputs.push(element.propertyName?.text ?? element.name.text);
    }
    return inputs;
  }
  return undefined;
}

interface Member {
  name: string;
  inputs: Inputs;
}

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
    if (member === undefined) continue;
    if (member.inputs === undefined) {
      report(
        `the ${kind} \`${declaration.name}\` uses unsupported parameter syntax, so its inputs cannot be checked`,
      );
      continue;
    }
    if ([...declaration.inputs].sort().join() === [...member.inputs].sort().join()) continue;
    report(
      `the ${kind} \`${declaration.name}\` declares the inputs ${listed(declaration.inputs)} ` +
        `but the class takes ${listed(member.inputs)}`,
    );
  }
}

export function conceptFailures(directory: string, projectRoot = ""): string[] {
  const within = projectRoot === "" ? directory : directory.slice(projectRoot.length + 1);
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

export async function conceptDirectories(
  roots: readonly string[],
  projectRoot = "",
): Promise<string[]> {
  const found = await Promise.all(
    roots.map((directory) =>
      filesBelow(resolve(projectRoot, directory), (name) => name === "spec.md"),
    ),
  );
  return found
    .flat()
    .map((path) => dirname(path))
    .sort();
}

const usage = `sync-engine check [--concepts <path...>] [--config path] [--fail-on-warnings]
  Check parsed action/query declarations against class source and optionally inspect application diagnostics.
  Defaults to src/concepts.`;

export async function checkCommand(args: readonly string[]): Promise<void> {
  let conceptRoots: string[] | undefined;
  let configPath: string | undefined;
  let failOnWarnings = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--concepts" && conceptRoots === undefined) {
      conceptRoots = [];
      while (args[index + 1] !== undefined && !args[index + 1].startsWith("-")) {
        conceptRoots.push(args[index + 1]);
        index += 1;
      }
      if (conceptRoots.length === 0) throw new Error(usage);
      continue;
    }
    if (argument === "--config" && configPath === undefined) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(usage);
      configPath = value;
      index += 1;
      continue;
    }
    if (argument === "--fail-on-warnings" && !failOnWarnings) {
      failOnWarnings = true;
      continue;
    }
    throw new Error(usage);
  }
  conceptRoots ??= ["src/concepts"];

  const root = process.cwd();
  const directories = await conceptDirectories(conceptRoots, root);
  if (directories.length === 0) {
    throw new Error(`No concept directories found under: ${conceptRoots.join(", ")}`);
  }
  const failures = directories.flatMap((directory) => conceptFailures(directory, root));
  if (failures.length > 0) {
    throw new Error(
      `Concept action/query source check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`Concept action/query source check passed for ${directories.length} concepts.`);

  if (configPath !== undefined) {
    const configUrl = pathToFileURL(resolve(root, configPath));
    const module = (await import(configUrl.href)) as { default?: GeneratedApplication };
    if (module.default === undefined) {
      throw new Error(`${configPath} must default-export an application artifact configuration`);
    }
    const application = resolveApplication(module.default, configUrl);
    const diagnostics = await inspectGenerated(
      application,
      (assembled) => applicationManifest(assembled).diagnostics,
    );
    for (const diagnostic of diagnostics) {
      console.log(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
    const policy = failOnWarnings ? "warnings" : "errors";
    if (diagnosticsFail(diagnostics, policy)) {
      throw new Error(`Application diagnostic check failed with policy "${policy}".`);
    }
    console.log(`Application diagnostic check passed with ${diagnostics.length} advisories.`);
  }
}
