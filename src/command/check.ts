import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseSpec, type ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { applicationManifest } from "@engine/tooling/manifest";
import { diagnosticsFail } from "@engine/tooling/diagnostics";
import { inspectGenerated } from "@engine/tooling/generated-artifacts";
import { assembledConcepts, loadRegisteredConcepts } from "./concept-discovery.ts";
import { registeredClassSources } from "./concept-source-discovery.ts";
import { filesBelow } from "./files-below.ts";
import { loadGeneratedApplication } from "./generated-config.ts";

function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

interface CheckerContext {
  program: ts.Program;
  checker: ts.TypeChecker;
}

type Inputs =
  | { ok: true; keys: readonly string[] }
  | {
      ok: false;
      parameterType: string;
      operation: string;
      detail: string;
      site: ts.Node;
    };

type TypeResolution =
  | { ok: true; alternatives: readonly (readonly string[])[] }
  | Extract<Inputs, { ok: false }>;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_TYPE_DEPTH = 32;
const MAX_KEY_ALTERNATIVES = 64;
const programCache = new Map<string, CheckerContext>();

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function configFailure(diagnostics: readonly ts.Diagnostic[]): never {
  throw new Error(`TypeScript project configuration failed: ${diagnosticText(diagnostics[0])}`);
}

function checkerFor(sourcePath: string): CheckerContext {
  const configPath = ts.findConfigFile(dirname(sourcePath), ts.sys.fileExists);
  if (configPath === undefined) {
    const cached = programCache.get(sourcePath);
    if (cached !== undefined) return cached;
    const program = ts.createProgram({
      rootNames: [sourcePath],
      options: {
        allowImportingTsExtensions: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ESNext,
      },
    });
    const context = { program, checker: program.getTypeChecker() };
    programCache.set(sourcePath, context);
    return context;
  }

  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) configFailure([loaded.error]);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath));
  if (parsed.errors.length > 0) configFailure(parsed.errors);
  const included = parsed.fileNames.some((path) => resolve(path) === sourcePath);
  const cacheKey = included ? configPath : `${configPath}\0${sourcePath}`;
  const cached = programCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const program = ts.createProgram({
    rootNames: included ? parsed.fileNames : [...parsed.fileNames, sourcePath],
    options: { ...parsed.options, noEmit: true },
    projectReferences: parsed.projectReferences,
  });
  const context = { program, checker: program.getTypeChecker() };
  programCache.set(cacheKey, context);
  return context;
}

function declarationOf(type: ts.Type, fallback: ts.Node): ts.Node {
  return type.aliasSymbol?.declarations?.[0] ?? type.getSymbol()?.declarations?.[0] ?? fallback;
}

function failedType(
  checker: ts.TypeChecker,
  parameterType: ts.Type,
  operation: string,
  detail: string,
  site: ts.Node,
): Extract<Inputs, { ok: false }> {
  return {
    ok: false,
    parameterType: checker.typeToString(
      parameterType,
      undefined,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    ),
    operation,
    detail,
    site,
  };
}

function uniqueAlternatives(alternatives: readonly (readonly string[])[]): string[][] {
  const unique = new Map<string, string[]>();
  for (const alternative of alternatives) {
    const keys = [...new Set(alternative)];
    const canonical = [...keys].sort().join("\0");
    if (!unique.has(canonical)) unique.set(canonical, keys);
  }
  return [...unique.values()];
}

function keySets(alternatives: readonly (readonly string[])[]): string {
  return alternatives
    .map(
      (keys) => `[${keys.length === 0 ? "no keys" : keys.map((key) => `\`${key}\``).join(", ")}]`,
    )
    .join(" and ");
}

function resolveTypeAlternatives(
  type: ts.Type,
  parameterType: ts.Type,
  fallback: ts.Node,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  depth: number,
): TypeResolution {
  const site = declarationOf(type, fallback);
  if (depth > MAX_TYPE_DEPTH) {
    return failedType(
      checker,
      parameterType,
      "type expansion",
      `type expansion exceeds ${MAX_TYPE_DEPTH} operations`,
      site,
    );
  }
  if (active.has(type)) {
    return failedType(
      checker,
      parameterType,
      "cyclic type",
      "a cyclic alias cannot be resolved",
      site,
    );
  }
  if ((type.flags & ts.TypeFlags.Any) !== 0) {
    return failedType(
      checker,
      parameterType,
      "any or unresolved type",
      "the type resolves to `any`, usually because a reference is unresolved",
      site,
    );
  }
  if ((type.flags & ts.TypeFlags.Unknown) !== 0) {
    return failedType(checker, parameterType, "unknown", "`unknown` has no finite key set", site);
  }
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    return failedType(
      checker,
      parameterType,
      "type parameter",
      "an unresolved type parameter has no finite key set",
      site,
    );
  }
  if ((type.flags & ts.TypeFlags.Never) !== 0) {
    return failedType(checker, parameterType, "never", "`never` is not an input object", site);
  }

  active.add(type);
  try {
    if (type.isUnion()) {
      const alternatives: (readonly string[])[] = [];
      for (const member of type.types) {
        const resolved = resolveTypeAlternatives(
          member,
          parameterType,
          fallback,
          checker,
          active,
          depth + 1,
        );
        if (!resolved.ok) return resolved;
        alternatives.push(...resolved.alternatives);
        if (alternatives.length > MAX_KEY_ALTERNATIVES) {
          return failedType(
            checker,
            parameterType,
            "union expansion",
            `the union exceeds ${MAX_KEY_ALTERNATIVES} possible key sets`,
            site,
          );
        }
      }
      return { ok: true, alternatives: uniqueAlternatives(alternatives) };
    }

    if (type.isIntersection()) {
      let combined: readonly (readonly string[])[] = [[]];
      for (const member of type.types) {
        const resolved = resolveTypeAlternatives(
          member,
          parameterType,
          fallback,
          checker,
          active,
          depth + 1,
        );
        if (!resolved.ok) return resolved;
        combined = uniqueAlternatives(
          combined.flatMap((left) => resolved.alternatives.map((right) => [...left, ...right])),
        );
        if (combined.length > MAX_KEY_ALTERNATIVES) {
          return failedType(
            checker,
            parameterType,
            "intersection expansion",
            `the intersection exceeds ${MAX_KEY_ALTERNATIVES} possible key sets`,
            site,
          );
        }
      }
      return { ok: true, alternatives: combined };
    }

    if ((type.flags & ts.TypeFlags.Object) === 0) {
      return failedType(
        checker,
        parameterType,
        "non-object type",
        `\`${checker.typeToString(type)}\` is not an object shape`,
        site,
      );
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      return failedType(
        checker,
        parameterType,
        "array type",
        "arrays and tuples are not concept input objects",
        site,
      );
    }
    if (
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
    ) {
      return failedType(
        checker,
        parameterType,
        "callable type",
        "callable and constructable values are not concept input objects",
        site,
      );
    }

    for (const index of checker.getIndexInfosOfType(type)) {
      if ((index.type.flags & ts.TypeFlags.Never) !== 0) continue;
      return failedType(
        checker,
        parameterType,
        "index signature",
        "an open index signature does not provide a finite input key set",
        index.declaration ?? site,
      );
    }

    const properties = checker.getPropertiesOfType(type);
    const keys: string[] = [];
    for (const property of properties) {
      const name = property.getName();
      if (!IDENTIFIER.test(name)) {
        return failedType(
          checker,
          parameterType,
          "property name",
          `the property ${JSON.stringify(name)} is not a concept input name`,
          property.declarations?.[0] ?? site,
        );
      }
      keys.push(name);
    }
    const object = type as ts.ObjectType;
    if (
      keys.length === 0 &&
      (object.objectFlags & ts.ObjectFlags.Mapped) !== 0 &&
      checker.getIndexInfosOfType(type).length === 0
    ) {
      return failedType(
        checker,
        parameterType,
        "mapped type",
        "the mapped type does not resolve to finite concrete properties",
        site,
      );
    }
    return { ok: true, alternatives: [[...new Set(keys)]] };
  } finally {
    active.delete(type);
  }
}

function compilerDiagnosticFor(
  program: ts.Program,
  parameter: ts.ParameterDeclaration,
  site: ts.Node,
): string | undefined {
  const files = new Set([parameter.getSourceFile(), site.getSourceFile()]);
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  const relevant = diagnostics.find(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error && files.has(diagnostic.file!),
  );
  return relevant === undefined ? undefined : diagnosticText(relevant);
}

function inputsOfType(
  typeNode: ts.TypeNode,
  parameter: ts.ParameterDeclaration,
  context: CheckerContext,
): Inputs {
  const type = context.checker.getTypeFromTypeNode(typeNode);
  let site: ts.Node = typeNode;
  if (ts.isTypeReferenceNode(typeNode)) {
    const symbol = context.checker.getSymbolAtLocation(typeNode.typeName);
    const target =
      symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? context.checker.getAliasedSymbol(symbol)
        : symbol;
    site = target?.declarations?.[0] ?? typeNode;
  }
  const resolved = resolveTypeAlternatives(type, type, site, context.checker, new Set(), 0);
  if (!resolved.ok) {
    const compilerDiagnostic = compilerDiagnosticFor(context.program, parameter, resolved.site);
    return compilerDiagnostic === undefined
      ? resolved
      : { ...resolved, detail: `${resolved.detail}; TypeScript reports: ${compilerDiagnostic}` };
  }
  const alternatives = uniqueAlternatives(resolved.alternatives);
  if (alternatives.length !== 1) {
    return failedType(
      context.checker,
      type,
      "ambiguous union or intersection",
      `the alternatives expose differing input key sets ${keySets(alternatives)}`,
      declarationOf(type, site),
    );
  }
  return { ok: true, keys: alternatives[0] };
}

function unsupportedParameter(method: ts.MethodDeclaration, detail: string): Inputs {
  return {
    ok: false,
    parameterType: method.parameters.map((parameter) => parameter.getText()).join(", ") || "none",
    operation: "parameter list",
    detail,
    site: method,
  };
}

function inputsOfMethod(method: ts.MethodDeclaration, context: CheckerContext): Inputs {
  if (method.parameters.length > 1) {
    return unsupportedParameter(
      method,
      "a concept member takes zero parameters or one object parameter",
    );
  }
  const [parameter] = method.parameters;
  if (parameter === undefined) return { ok: true, keys: [] };
  if (parameter.dotDotDotToken !== undefined) {
    return unsupportedParameter(method, "a rest parameter is not one object parameter");
  }
  if (parameter.type !== undefined) return inputsOfType(parameter.type, parameter, context);
  if (ts.isObjectBindingPattern(parameter.name)) {
    const inputs: string[] = [];
    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) {
        return unsupportedParameter(method, "untyped destructuring must use flat identifier keys");
      }
      if (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName)) {
        return unsupportedParameter(method, "untyped destructuring must use identifier keys");
      }
      inputs.push(element.propertyName?.text ?? element.name.text);
    }
    return { ok: true, keys: inputs };
  }
  return unsupportedParameter(method, "an untyped parameter must destructure an object");
}

interface Member {
  name: string;
  inputs: Inputs;
}

function membersOfClass(
  declaration: ts.ClassDeclaration,
  context: CheckerContext,
  includeInherited = false,
): Member[] {
  if (includeInherited && declaration.name !== undefined) {
    const symbol = context.checker.getSymbolAtLocation(declaration.name);
    if (symbol === undefined) return [];
    const instance = context.checker.getDeclaredTypeOfSymbol(symbol);
    return context.checker.getPropertiesOfType(instance).flatMap((property) => {
      const method = property.declarations?.find(ts.isMethodDeclaration);
      return method === undefined || !ts.isIdentifier(method.name)
        ? []
        : [{ name: method.name.text, inputs: inputsOfMethod(method, context) }];
    });
  }

  const members: Member[] = [];
  for (const member of declaration.members) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const modifiers = ts.getModifiers(member) ?? [];
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword)) continue;
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword)) continue;
    members.push({ name: member.name.text, inputs: inputsOfMethod(member, context) });
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
  locationBase: string,
  report: (what: string) => void,
  options: { checkMembership: boolean; sourceInputMembers?: ReadonlySet<string> } = {
    checkMembership: true,
  },
): void {
  if (options.checkMembership) {
    const declared = declarations.map(({ name }) => name);
    const implemented = members.map(({ name }) => name);
    const missing = declared.filter((name) => !implemented.includes(name));
    if (missing.length > 0) {
      report(`the specification declares the ${kind} ${listed(missing)}, which the class lacks`);
    }
    const unspecified = implemented.filter((name) => !declared.includes(name));
    if (unspecified.length > 0) {
      report(
        `the class declares the ${kind} ${listed(unspecified)}, which the specification lacks`,
      );
    }
  }
  for (const declaration of declarations) {
    if (
      options.sourceInputMembers !== undefined &&
      !options.sourceInputMembers.has(declaration.name)
    ) {
      continue;
    }
    const member = members.find(({ name }) => name === declaration.name);
    if (member === undefined) {
      if (options.sourceInputMembers !== undefined) {
        report(`the ${kind} \`${declaration.name}\` source declaration could not be located`);
      }
      continue;
    }
    if (!member.inputs.ok) {
      const source = member.inputs.site.getSourceFile();
      const position = source.getLineAndCharacterOfPosition(member.inputs.site.getStart(source));
      const local = relative(locationBase, source.fileName);
      const location = `${local.startsWith("..") ? source.fileName : local}:${position.line + 1}:${position.character + 1}`;
      report(
        `the ${kind} \`${declaration.name}\` parameter type \`${member.inputs.parameterType}\` cannot be checked: ` +
          `${member.inputs.operation} at ${location}: ${member.inputs.detail}`,
      );
      continue;
    }
    if ([...declaration.inputs].sort().join() === [...member.inputs.keys].sort().join()) continue;
    report(
      `the ${kind} \`${declaration.name}\` declares the inputs ${listed(declaration.inputs)} ` +
        `but the class takes ${listed(member.inputs.keys)}`,
    );
  }
}

function sourceFailures(
  classPath: string,
  className: string,
  spec: ConceptSpec,
  label: string,
  locationBase: string,
  sourceInputMembers?: ReadonlySet<string>,
): string[] {
  const findings: string[] = [];
  const report = (what: string): void => void findings.push(`${label}: ${what}.`);
  let context: CheckerContext;
  try {
    context = checkerFor(classPath);
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    return findings;
  }
  const source = context.program.getSourceFile(classPath);
  if (source === undefined) {
    report(`${basename(classPath)} could not be loaded by the TypeScript project`);
    return findings;
  }
  const declaration = classIn(source, className);
  if (declaration === undefined) {
    report(`${basename(classPath)} does not declare ${className}`);
    return findings;
  }

  const runtimeSelected = sourceInputMembers !== undefined;
  const members = membersOfClass(declaration, context, runtimeSelected);
  const options = { checkMembership: !runtimeSelected, sourceInputMembers };
  compare(
    "action",
    spec.actions,
    members.filter(({ name }) => !name.startsWith("_")),
    locationBase,
    report,
    options,
  );
  compare(
    "query",
    spec.queries,
    members.filter(({ name }) => name.startsWith("_")),
    locationBase,
    report,
    options,
  );
  return findings;
}

export function conceptFailures(directory: string, projectRoot = ""): string[] {
  const within = projectRoot === "" ? directory : directory.slice(projectRoot.length + 1);
  const label = within === "" || within.startsWith("..") ? directory : within;
  const registryPath = join(directory, "registry.ts");
  let spec: ConceptSpec;
  try {
    spec = parseSpec(readFileSync(join(directory, "spec.md"), "utf8"));
  } catch (error) {
    return [`${label}: ${error instanceof Error ? error.message : String(error)}.`];
  }

  const registered = registeredClass(parseFile(registryPath));
  if (registered === undefined) {
    return [`${label}: registry.ts does not register a class imported by name.`];
  }
  return sourceFailures(
    resolve(dirname(registryPath), registered.from),
    registered.name,
    spec,
    label,
    projectRoot === "" ? directory : projectRoot,
  );
}

export async function conceptDirectories(
  roots: readonly string[],
  projectRoot = "",
): Promise<string[]> {
  const found = await Promise.all(
    roots.map((directory) => {
      const root = resolve(projectRoot, directory);
      return existsSync(root) ? filesBelow(root, (name) => name === "spec.md") : [];
    }),
  );
  return found
    .flat()
    .map((path) => dirname(path))
    .sort();
}

const usage = `sync-engine check [--vocabulary-module path | --config path] [--fail-on-warnings]
  Check registered concepts against erased TypeScript source and optionally inspect application diagnostics.
  Without a config, defaults to the conventional src/concept-set.ts vocabulary module.`;

export async function checkCommand(args: readonly string[]): Promise<void> {
  let vocabularyModuleArgument: string | undefined;
  let configPath: string | undefined;
  let failOnWarnings = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--vocabulary-module" && vocabularyModuleArgument === undefined) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-") || configPath !== undefined) {
        throw new Error(usage);
      }
      vocabularyModuleArgument = value;
      index += 1;
      continue;
    }
    if (argument === "--config" && configPath === undefined) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-") || vocabularyModuleArgument !== undefined) {
        throw new Error(usage);
      }
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
  const root = process.cwd();
  const application =
    configPath === undefined ? undefined : await loadGeneratedApplication(configPath, root);
  const vocabularyModulePath =
    application !== undefined
      ? resolve(fileURLToPath(application.directory), application.vocabularyFrom.from)
      : resolve(root, vocabularyModuleArgument ?? "src/concept-set.ts");
  if (!existsSync(vocabularyModulePath)) {
    throw new Error(`Vocabulary module does not exist: ${relative(root, vocabularyModulePath)}`);
  }

  const manifest =
    application === undefined
      ? undefined
      : await inspectGenerated(application, (assembled) => applicationManifest(assembled));
  const concepts =
    manifest === undefined
      ? await loadRegisteredConcepts(vocabularyModulePath)
      : assembledConcepts(manifest);
  const sources = registeredClassSources(vocabularyModulePath);
  const failures: string[] = [];
  for (const concept of concepts) {
    const source = sources.find(({ conceptName }) => conceptName === concept.name);
    const label = `${relative(root, vocabularyModulePath)} (${concept.name})`;
    if (source === undefined) {
      failures.push(`${label}: registered class import could not be resolved.`);
      continue;
    }
    if (source.className !== concept.className) {
      failures.push(
        `${label}: source resolves ${source.className}, but registration selected ${concept.className}.`,
      );
      continue;
    }
    failures.push(
      ...sourceFailures(
        source.classPath,
        source.className,
        concept.specification,
        label,
        root,
        concept.sourceInputMembers,
      ),
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Concept action/query source check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`Concept action/query source check passed for ${concepts.length} concepts.`);

  if (manifest !== undefined) {
    const diagnostics = manifest.diagnostics;
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
