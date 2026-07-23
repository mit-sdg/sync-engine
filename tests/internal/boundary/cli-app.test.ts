import { describe, expect, test, vi } from "vite-plus/test";
import {
  cliFail as fail,
  cliOk as ok,
  command,
  createCliApp,
  parseArgs,
  parseOk,
} from "@sync-engine/internal/boundary";
import type { ParsedArgs } from "@sync-engine/internal/boundary";

describe("parseArgs", () => {
  test("no arguments produce empty positional and option groups", () => {
    expect(parseArgs([])).toEqual({ positionals: [], options: {} });
  });

  test("bare arguments stay in positional order", () => {
    expect(parseArgs(["add", "buy milk", "extra"])).toEqual({
      positionals: ["add", "buy milk", "extra"],
      options: {},
    });
  });

  test("valueless flags become true options", () => {
    expect(parseArgs(["--all", "--verbose"])).toEqual({
      positionals: [],
      options: { all: true, verbose: true },
    });
  });

  test("a flag consumes its following value", () => {
    expect(parseArgs(["--priority", "high", "--tag", "urgent"])).toEqual({
      positionals: [],
      options: { priority: "high", tag: "urgent" },
    });
  });

  test("positionals and options are separated without reordering", () => {
    expect(parseArgs(["add", "buy milk", "--priority", "high", "--all"])).toEqual({
      positionals: ["add", "buy milk"],
      options: { priority: "high", all: true },
    });
  });

  test("a final valueless option becomes true", () => {
    expect(parseArgs(["--all"])).toEqual({
      positionals: [],
      options: { all: true },
    });
  });

  test("a following flag starts a separate true option", () => {
    expect(parseArgs(["--name", "--verbose"])).toEqual({
      positionals: [],
      options: { name: true, verbose: true },
    });
  });
});

describe("ok / fail", () => {
  test("ok terminates stdout with one newline", () => {
    expect(ok("hello")).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  test("ok preserves an existing stdout newline", () => {
    expect(ok("hello\n")).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  test("fail terminates stderr with one newline", () => {
    expect(fail("bad")).toEqual({ stdout: "", stderr: "bad\n", exitCode: 1 });
  });

  test("fail preserves an existing stderr newline", () => {
    expect(fail("bad\n")).toEqual({ stdout: "", stderr: "bad\n", exitCode: 1 });
  });
});

describe("createCliApp", () => {
  test("runs and dispatches endpoint commands through the supplied invoker", async () => {
    const invoke = vi.fn(async (_path: string, input: { message: string }) => ({
      ok: true as const,
      value: { echoed: input.message },
    }));
    const app = createCliApp(
      {
        echo: command(
          { path: "/echo" },
          {
            parse: (positionals) => parseOk({ message: positionals.join(" ") }),
            format: (result) => (result.ok ? ok(result.value.echoed) : fail("unexpected")),
          },
        ),
      },
      { invoker: { invoke } as never },
    );

    expect(await app.run(["echo", "hello", "world"])).toEqual({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await app.dispatch("echo", { message: "direct" })).toEqual({
      stdout: "direct\n",
      stderr: "",
      exitCode: 0,
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "/echo", { message: "hello world" });
    expect(invoke).toHaveBeenNthCalledWith(2, "/echo", { message: "direct" });
  });

  test("endpoint commands fail clearly when no invoker is configured", async () => {
    const app = createCliApp({
      echo: command(
        { path: "/echo" },
        { parse: () => parseOk({}), format: () => ok("unreachable") },
      ),
    });

    await expect(app.run(["echo"])).resolves.toEqual({
      stdout: "",
      stderr: 'Endpoint command "/echo" needs an invoker.\n',
      exitCode: 1,
    });
  });

  test("run dispatches the command named by the first argument", async () => {
    const app = createCliApp({
      ping: {
        run: async (_input) => ok("pong"),
      },
    });

    const result = await app.run(["ping"]);
    expect(result).toEqual({ stdout: "pong\n", stderr: "", exitCode: 0 });
  });

  test("run returns help for an empty command and each help spelling", async () => {
    const app = createCliApp(
      {
        ping: {
          description: "Send a ping",
          run: async () => ok("pong"),
        },
      },
      { name: "testcli" },
    );

    for (const args of [[], ["help"], ["--help"], ["-h"]]) {
      const result = await app.run(args);
      expect(result).toEqual({
        stdout:
          "testcli\n\nCommands:\n" +
          "  ping      Send a ping\n" +
          "  help      Show command help.\n",
        stderr: "",
        exitCode: 0,
      });
    }
  });

  test("run returns exit code 1 and names an unknown command", async () => {
    const app = createCliApp({
      ping: {
        run: async () => ok("pong"),
      },
    });

    const result = await app.run(["unknown"]);
    expect(result).toEqual({
      stdout: "",
      stderr: "Unknown command: unknown\nRun 'cli help' to list commands.\n",
      exitCode: 1,
    });
  });

  test("dispatch routes to typed input directly", async () => {
    const app = createCliApp({
      echo: {
        parse: (args) => ({ message: args.join(" ") }),
        run: async ({ message }) => ok(message),
      },
    });

    const result = await app.dispatch("echo", { message: "hello world" });
    expect(result).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test("dispatch passes the parser's inferred input shape to run", async () => {
    const app = createCliApp({
      add: {
        parse: (_args, opts) => {
          const priority = String(opts.priority ?? "normal");
          return { title: "test", priority };
        },
        run: async (input) => {
          expect(typeof input.title).toBe("string");
          expect(typeof input.priority).toBe("string");
          return ok(`${input.title} [${input.priority}]`);
        },
      },
    });

    const result = await app.dispatch("add", { title: "hello", priority: "high" });
    expect(result.stdout).toBe("hello [high]\n");
  });

  test("run gives parsed arguments to the command handler", async () => {
    const app = createCliApp({
      add: {
        parse: (args, opts) => {
          if (args.length === 0) return fail("title required");
          const priority = String(opts.priority ?? "normal");
          return { title: args.join(" "), priority };
        },
        run: async ({ title, priority }) => ok(`${title} [${priority}]`),
      },
    });

    const result = await app.run(["add", "buy milk", "--priority", "high"]);
    expect(result).toEqual({ stdout: "buy milk [high]\n", stderr: "", exitCode: 0 });
  });

  test("run returns a parser failure without calling the command handler", async () => {
    const app = createCliApp({
      add: {
        parse: (_args) => fail("title required"),
        run: async () => ok("should not reach"),
      },
    });

    const result = await app.run(["add"]);
    expect(result).toEqual({ stdout: "", stderr: "title required\n", exitCode: 1 });
  });

  test("run returns a thrown command error on stderr", async () => {
    const app = createCliApp({
      explode: {
        run: async () => {
          throw new Error("boom");
        },
      },
    });

    const result = await app.run(["explode"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
  });

  test("a command without a parser receives ParsedArgs", async () => {
    const app = createCliApp({
      raw: {
        run: async (input: ParsedArgs) => ok(JSON.stringify(input)),
      },
    });

    const result = await app.run(["raw", "hello", "--flag", "--key", "value"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({
      positionals: ["hello"],
      options: { flag: true, key: "value" },
    });
  });

  test("help labels a command whose description is absent", async () => {
    const app = createCliApp({
      cmd: {
        run: async () => ok("done"),
      },
    });

    const result = await app.run(["help"]);
    expect(result.stdout).toContain("No description provided.");
  });

  test("an unknown command error omits stack text", async () => {
    const app = createCliApp({});
    const result = await app.run(["wat"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("Error");
    expect(result.stderr).not.toContain("at ");
  });

  test("dispatch calls the command selected by its typed key", async () => {
    const app = createCliApp({
      ping: {
        run: async () => ok("pong"),
      },
    });

    const result = await app.dispatch("ping", {});
    expect(result.stdout).toBe("pong\n");
  });

  test("help includes the supplied application name and version", async () => {
    const app = createCliApp(
      {
        cmd: {
          description: "A command",
          run: async () => ok("ok"),
        },
      },
      { name: "myapp", version: "1.0.0" },
    );

    const result = await app.run(["--help"]);
    expect(result.stdout).toContain("myapp");
    expect(result.stdout).toContain("1.0.0");
  });

  test("help returns the application name and each command description", () => {
    const app = createCliApp(
      {
        add: {
          description: "Add an item",
          run: async () => ok("ok"),
        },
        list: {
          description: "List items",
          run: async () => ok("ok"),
        },
      },
      { name: "demo" },
    );

    const text = app.help();
    expect(text).toContain("demo");
    expect(text).toContain("add");
    expect(text).toContain("Add an item");
    expect(text).toContain("list");
    expect(text).toContain("List items");
  });

  test("each command keeps its own parsed and dispatched input shape", async () => {
    const app = createCliApp({
      add: {
        parse: (args, opts) => {
          const priority = String(opts.priority ?? "normal");
          return { title: args.join(" "), priority };
        },
        run: async ({ title, priority }) => ok(`added ${title} [${priority}]`),
      },
      list: {
        parse: (_args, opts) => ({ all: Boolean(opts.all) }),
        run: async ({ all }) => ok(all ? "all items" : "open items"),
      },
    });

    const addResult = await app.run(["add", "test", "--priority", "low"]);
    expect(addResult.stdout).toBe("added test [low]\n");

    const listResult = await app.run(["list", "--all"]);
    expect(listResult.stdout).toBe("all items\n");

    const typedAdd = await app.dispatch("add", { title: "hello", priority: "high" });
    expect(typedAdd.stdout).toBe("added hello [high]\n");

    const typedList = await app.dispatch("list", { all: false });
    expect(typedList.stdout).toBe("open items\n");
  });
});
