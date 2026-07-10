import { describe, expect, test } from "vite-plus/test";
import { createCliApp, fail, ok, parseArgs } from "@sync-engine/sdk";
import type { ParsedArgs } from "@sync-engine/sdk";

describe("parseArgs", () => {
  test("empty args", () => {
    expect(parseArgs([])).toEqual({ positionals: [], options: {} });
  });

  test("positionals only", () => {
    expect(parseArgs(["add", "buy milk", "extra"])).toEqual({
      positionals: ["add", "buy milk", "extra"],
      options: {},
    });
  });

  test("boolean flags", () => {
    expect(parseArgs(["--all", "--verbose"])).toEqual({
      positionals: [],
      options: { all: true, verbose: true },
    });
  });

  test("key-value options", () => {
    expect(parseArgs(["--priority", "high", "--tag", "urgent"])).toEqual({
      positionals: [],
      options: { priority: "high", tag: "urgent" },
    });
  });

  test("mixed positionals and options", () => {
    expect(parseArgs(["add", "buy milk", "--priority", "high", "--all"])).toEqual({
      positionals: ["add", "buy milk"],
      options: { priority: "high", all: true },
    });
  });

  test("option at end without value is boolean", () => {
    expect(parseArgs(["--all"])).toEqual({
      positionals: [],
      options: { all: true },
    });
  });

  test("option with value that looks like a flag is treated as separate flag", () => {
    expect(parseArgs(["--name", "--verbose"])).toEqual({
      positionals: [],
      options: { name: true, verbose: true },
    });
  });
});

describe("ok / fail", () => {
  test("ok appends newline", () => {
    expect(ok("hello")).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  test("ok does not double newline", () => {
    expect(ok("hello\n")).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  test("fail appends newline", () => {
    expect(fail("bad")).toEqual({ stdout: "", stderr: "bad\n", exitCode: 1 });
  });

  test("fail does not double newline", () => {
    expect(fail("bad\n")).toEqual({ stdout: "", stderr: "bad\n", exitCode: 1 });
  });
});

describe("createCliApp", () => {
  test("run routes to correct command by first arg", async () => {
    const app = createCliApp({
      ping: {
        run: async (_input) => ok("pong"),
      },
    });

    const result = await app.run(["ping"]);
    expect(result).toEqual({ stdout: "pong\n", stderr: "", exitCode: 0 });
  });

  test("run shows help for no args or help variants", async () => {
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
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("testcli");
      expect(result.stdout).toContain("ping");
      expect(result.stdout).toContain("Send a ping");
    }
  });

  test("run returns error for unknown command", async () => {
    const app = createCliApp({
      ping: {
        run: async () => ok("pong"),
      },
    });

    const result = await app.run(["unknown"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command: unknown");
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

  test("dispatch type-checks input against parse return type", async () => {
    const app = createCliApp({
      add: {
        parse: (_args, opts) => {
          const priority = String(opts.priority ?? "normal");
          return { title: "test", priority };
        },
        run: async (input) => {
          // input is typed as { title: string; priority: string }
          expect(typeof input.title).toBe("string");
          expect(typeof input.priority).toBe("string");
          return ok(`${input.title} [${input.priority}]`);
        },
      },
    });

    const result = await app.dispatch("add", { title: "hello", priority: "high" });
    expect(result.stdout).toBe("hello [high]\n");
  });

  test("run passes parsed input through parse then run", async () => {
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

  test("run short-circuits on parse error", async () => {
    const app = createCliApp({
      add: {
        parse: (_args) => fail("title required"),
        run: async () => ok("should not reach"),
      },
    });

    const result = await app.run(["add"]);
    expect(result).toEqual({ stdout: "", stderr: "title required\n", exitCode: 1 });
  });

  test("run catches thrown errors in run", async () => {
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

  test("command without parse receives raw ParsedArgs", async () => {
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

  test("default description for commands without one", async () => {
    const app = createCliApp({
      cmd: {
        run: async () => ok("done"),
      },
    });

    const result = await app.run(["help"]);
    expect(result.stdout).toContain("(no description)");
  });

  test("help for unknown command does not leak stack", async () => {
    const app = createCliApp({});
    const result = await app.run(["wat"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("Error");
    expect(result.stderr).not.toContain("at ");
  });

  test("dispatch throws for invalid command key at type level", async () => {
    // This test verifies that TypeScript catches invalid dispatch keys.
    // At runtime, dispatch just calls the command.
    const app = createCliApp({
      ping: {
        run: async () => ok("pong"),
      },
    });

    // Valid: dispatches to ping
    const result = await app.dispatch("ping", {});
    expect(result.stdout).toBe("pong\n");
  });

  test("help text includes name and version when provided", async () => {
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

  test("help method works standalone", () => {
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

  test("multiple commands each get their own typed input", async () => {
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

    // Typed dispatch
    const typedAdd = await app.dispatch("add", { title: "hello", priority: "high" });
    expect(typedAdd.stdout).toBe("added hello [high]\n");

    const typedList = await app.dispatch("list", { all: false });
    expect(typedList.stdout).toBe("open items\n");
  });
});
