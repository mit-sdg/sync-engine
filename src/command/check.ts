import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseSpec, type ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { applicationManifest, type ApplicationManifestV1 } from "@engine/tooling/manifest";
import { diagnosticsFail } from "@engine/tooling/diagnostics";
import {
  inspectGenerated,
  type GeneratedSourceAnalysis,
  type ResolvedApplication,
} from "@engine/tooling/generated-artifacts";
import { assembledConcepts } from "./concept-discovery.ts";
import { filesBelow } from "./files-below.ts";
import { loadGeneratedApplication } from "./generated-config.ts";
import {
  type ShapeField,
  type ShapeResolution,
  type TypeScriptCheckerContext,
  resultShapeOfMethod,
  shapeOfTypeNode,
  shapesEqual,
} from "@engine/tooling/typescript-shapes";

function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

type CheckerContext = TypeScriptCheckerContext;
type Inputs = ShapeResolution;

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

function unsupportedParameter(method: ts.MethodDeclaration, detail: string): Inputs {
  return {
    ok: false,
    type: method.parameters.map((parameter) => parameter.getText()).join(", ") || "none",
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
  if (parameter === undefined) return { ok: true, fields: [] };
  if (parameter.dotDotDotToken !== undefined) {
    return unsupportedParameter(method, "a rest parameter is not one object parameter");
  }
  if (parameter.type !== undefined) return shapeOfTypeNode(parameter.type, parameter, context);
  if (ts.isObjectBindingPattern(parameter.name)) {
    const fields: ShapeField[] = [];
    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) {
        return unsupportedParameter(method, "untyped destructuring must use flat identifier keys");
      }
      if (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName)) {
        return unsupportedParameter(method, "untyped destructuring must use identifier keys");
      }
      fields.push({
        name: element.propertyName?.text ?? element.name.text,
        optional: element.initializer !== undefined,
      });
    }
    return { ok: true, fields };
  }
  return unsupportedParameter(method, "an untyped parameter must destructure an object");
}

interface Member {
  name: string;
  inputs: Inputs;
  result: ShapeResolution;
}

function sourceMember(method: ts.MethodDeclaration, context: CheckerContext): Member {
  const identifier = method.name as ts.Identifier;
  const name = identifier.text;
  const declarations = context.checker
    .getSymbolAtLocation(identifier)
    ?.declarations?.filter(ts.isMethodDeclaration);
  if (declarations !== undefined && declarations.length > 1) {
    const unsupported: ShapeResolution = {
      ok: false,
      type: "overloaded method",
      operation: "method overload",
      detail: "overloaded concept members do not expose one implementation shape",
      site: method,
    };
    return { name, inputs: unsupported, result: unsupported };
  }
  return {
    name,
    inputs: inputsOfMethod(method, context),
    result: resultShapeOfMethod(method, name.startsWith("_") ? "query" : "action", context),
  };
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
        : [sourceMember(method, context)];
    });
  }

  const members: Member[] = [];
  for (const member of declaration.members) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const modifiers = ts.getModifiers(member) ?? [];
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword)) continue;
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword)) continue;
    members.push(sourceMember(member, context));
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

const listed = (fields: readonly { name: string; optional?: boolean }[]): string =>
  fields.length === 0
    ? "none"
    : fields.map(({ name, optional }) => `\`${name}${optional === true ? "?" : ""}\``).join(", ");

function failureDetail(failure: Extract<ShapeResolution, { ok: false }>, base: string): string {
  const source = failure.site.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(failure.site.getStart(source));
  const local = relative(base, source.fileName);
  const location = `${local.startsWith("..") ? source.fileName : local}:${position.line + 1}:${position.character + 1}`;
  return `type \`${failure.type}\` cannot be checked: ${failure.operation} at ${location}: ${failure.detail}`;
}

type SourceDeclaration = ConceptSpec["actions"][number] | ConceptSpec["queries"][number];

function compare(
  kind: "action" | "query",
  declarations: readonly SourceDeclaration[],
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
      report(
        `the specification declares the ${kind} ${listed(missing.map((name) => ({ name })))}, which the class lacks`,
      );
    }
    const unspecified = implemented.filter((name) => !declared.includes(name));
    if (unspecified.length > 0) {
      report(
        `the class declares the ${kind} ${listed(unspecified.map((name) => ({ name })))}, which the specification lacks`,
      );
    }
  }

  for (const declaration of declarations) {
    const member = members.find(({ name }) => name === declaration.name);
    if (member === undefined) {
      if (options.sourceInputMembers !== undefined) {
        report(`the ${kind} \`${declaration.name}\` source declaration could not be located`);
      }
      continue;
    }

    const checkInputs =
      options.sourceInputMembers === undefined || options.sourceInputMembers.has(declaration.name);
    if (checkInputs) {
      if (!member.inputs.ok) {
        report(
          `the ${kind} \`${declaration.name}\` parameter ${failureDetail(member.inputs, locationBase)}`,
        );
      } else if (!shapesEqual(declaration.parameters, member.inputs.fields)) {
        report(
          `the ${kind} \`${declaration.name}\` declares the inputs ${listed(declaration.parameters)} ` +
            `but the class takes ${listed(member.inputs.fields)}`,
        );
      }
    }

    const resultLabel = kind === "action" ? "successful result" : "row";
    if (declaration.result.kind !== "fields") {
      report(`the ${kind} \`${declaration.name}\` does not declare named ${resultLabel} fields`);
    } else if (!member.result.ok) {
      report(
        `the ${kind} \`${declaration.name}\` ${resultLabel} ${failureDetail(member.result, locationBase)}`,
      );
    } else if (!shapesEqual(declaration.result.fields, member.result.fields)) {
      report(
        `the ${kind} \`${declaration.name}\` declares the ${resultLabel} fields ${listed(declaration.result.fields)} ` +
          `but the class returns ${listed(member.result.fields)}`,
      );
    }
  }
}

function sourceFailures(
  classPath: string,
  className: string,
  spec: ConceptSpec,
  label: string,
  locationBase: string,
  sourceInputMembers?: ReadonlySet<string>,
  suppliedContext?: CheckerContext,
): string[] {
  const findings: string[] = [];
  const report = (what: string): void => void findings.push(`${label}: ${what}.`);
  let context: CheckerContext;
  try {
    context = suppliedContext ?? checkerFor(classPath);
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

const usage = `sync-engine check [--config path] [--fail-on-warnings]
  Check the configured application, including concept TypeScript source agreement and application diagnostics.
  The configuration path defaults to generated.config.ts.`;

function conceptSourceFailures(
  vocabularyModulePath: string,
  concepts: ReturnType<typeof assembledConcepts>,
  sourceAnalysis: GeneratedSourceAnalysis,
  root: string,
): string[] {
  const sources = sourceAnalysis.concepts;
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
        sourceAnalysis.context,
      ),
    );
  }
  return failures;
}

function assertConceptSources(failures: readonly string[]): void {
  if (failures.length === 0) return;
  throw new Error(
    `Concept action/query source check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}

async function checkConfiguredApplication(
  application: ResolvedApplication,
  root: string,
  failOnWarnings: boolean,
): Promise<void> {
  const { manifest, sourceAnalysis } = await inspectGenerated(
    application,
    (assembled, sourceAnalysis) => ({
      manifest: applicationManifest(assembled),
      sourceAnalysis,
    }),
  );
  const vocabularyModulePath = fileURLToPath(application.vocabularyModule);
  const concepts = assembledConcepts(manifest);
  assertConceptSources(conceptSourceFailures(vocabularyModulePath, concepts, sourceAnalysis, root));
  console.log(`Concept action/query source check passed for ${concepts.length} concepts.`);

  // Authored-design loading and coverage belongs at this exact config/manifest boundary.
  // Its orchestrator should be called here before the existing application diagnostics policy.
  reportApplicationDiagnostics(manifest, failOnWarnings);
}

function reportApplicationDiagnostics(
  manifest: ApplicationManifestV1,
  failOnWarnings: boolean,
): void {
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

export async function checkCommand(args: readonly string[]): Promise<void> {
  let configPath = "generated.config.ts";
  let hasConfigArgument = false;
  let failOnWarnings = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config" && !hasConfigArgument) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(usage);
      configPath = value;
      hasConfigArgument = true;
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
  if (!existsSync(resolve(root, configPath))) {
    throw new Error(`Configuration does not exist: ${configPath}`);
  }
  const application = await loadGeneratedApplication(configPath, root);
  await checkConfiguredApplication(application, root, failOnWarnings);
}
