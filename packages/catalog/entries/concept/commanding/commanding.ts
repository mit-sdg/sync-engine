const INVALID_ARGUMENTS = "Arguments must be an ordinary dense list of text values.";
const INVOCATION_CAPTURED = "This command invocation already has different words.";
const INVALID_STREAM = "A command stream must be output or error.";
const INVALID_TEXT = "A command line must be well-formed text.";
const INVALID_EXIT_CODE = "A command exit code must be a safe integer from 0 through 255.";
const EXIT_SELECTED = "This command invocation already has another exit status.";

export type CommandStream = "output" | "error";
export interface CommandEnvironment {
  arguments(): readonly string[];
  write(stream: CommandStream, text: string): void;
  exit(code: number): void;
}

const host: CommandEnvironment = {
  arguments: () => process.argv.slice(2),
  write(stream, text) {
    if (stream === "output") console.log(text);
    else console.error(text);
  },
  exit: (code) => {
    process.exitCode = code;
  },
};

export class InvalidArguments extends Error {
  constructor() {
    super(INVALID_ARGUMENTS);
    this.name = "InvalidArguments";
  }
}

export class InvocationCaptured extends Error {
  constructor() {
    super(INVOCATION_CAPTURED);
    this.name = "InvocationCaptured";
  }
}

export class InvalidStream extends Error {
  constructor() {
    super(INVALID_STREAM);
    this.name = "InvalidStream";
  }
}

export class InvalidText extends Error {
  constructor() {
    super(INVALID_TEXT);
    this.name = "InvalidText";
  }
}

export class InvalidExitCode extends Error {
  constructor() {
    super(INVALID_EXIT_CODE);
    this.name = "InvalidExitCode";
  }
}

export class ExitSelected extends Error {
  constructor() {
    super(EXIT_SELECTED);
    this.name = "ExitSelected";
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed();
}

function isArguments(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === value.length &&
    keys.every((key, index) => key === String(index)) &&
    value.every(isText)
  );
}

/** Expose one command-line invocation without leaking ambient process access. */
export class CommandingConcept {
  #words: string[] | undefined;
  #exitCode: number | undefined;

  constructor(private readonly environment: CommandEnvironment = host) {}

  captureArguments({ arguments: supplied }: { arguments: readonly string[] | null }) {
    if (supplied !== null && !isArguments(supplied)) throw new InvalidArguments();
    if (this.#words !== undefined) {
      if (
        supplied !== null &&
        (supplied.length !== this.#words.length ||
          supplied.some((word, index) => word !== this.#words![index]))
      ) {
        throw new InvocationCaptured();
      }
      return { words: [...this.#words] };
    }

    const words = supplied ?? this.environment.arguments();
    if (!isArguments(words)) throw new InvalidArguments();
    this.#words = [...words];
    return { words: [...this.#words] };
  }

  writeLine({ stream, text }: { stream: string; text: string }) {
    if (stream !== "output" && stream !== "error") throw new InvalidStream();
    if (!isText(text)) throw new InvalidText();
    this.environment.write(stream, text);
    return { stream, text };
  }

  setExitStatus({ code }: { code: number }) {
    if (!Number.isSafeInteger(code) || code < 0 || code > 255) throw new InvalidExitCode();
    if (this.#exitCode !== undefined) {
      if (this.#exitCode !== code) throw new ExitSelected();
      return { code, changed: false };
    }
    this.environment.exit(code);
    this.#exitCode = code;
    return { code, changed: true };
  }

  _invocation(): { words: string[] }[] {
    return this.#words === undefined ? [] : [{ words: [...this.#words] }];
  }

  _outcome(): { code: number }[] {
    return this.#exitCode === undefined ? [] : [{ code: this.#exitCode }];
  }
}
