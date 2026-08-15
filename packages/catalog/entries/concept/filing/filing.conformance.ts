import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  FileNotFound,
  type FilingConcept,
  InvalidEncoding,
  InvalidPath,
  InvalidSource,
  PathLeavesRoot,
  RootNotFound,
} from "./filing.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (content: Uint8Array): string => new TextDecoder().decode(content);

export function filingConformance(implementation: string, create: () => FilingConcept): void {
  describe(`Filing ${implementation}`, () => {
    test("follows its principle by replacing a named tree only after a complete read", async () => {
      const directory = await mkdtemp(join(tmpdir(), "filing-load-"));
      const outside = await mkdtemp(join(tmpdir(), "filing-outside-"));
      try {
        await mkdir(join(directory, "posts"));
        await writeFile(join(directory, "posts", "page.md"), "first\n");
        await writeFile(join(directory, "picture.png"), "picture\n");
        const concept = create();

        const first = await concept.replaceTreeFromDirectory({ name: "content", directory });
        expect(first).toMatchObject({ status: "loaded", count: 2, changed: true });
        if (first.status !== "loaded" || first.root === undefined) {
          throw new Error(first.detail ?? "loaded tree has no root");
        }
        const page = concept._at({ root: first.root, path: "posts/page.md" })[0]?.file;
        const picture = concept._at({ root: first.root, path: "picture.png" })[0]?.file;
        if (page === undefined || picture === undefined) throw new Error("loaded files are absent");

        await writeFile(join(directory, "posts", "page.md"), "second\n");
        await rm(join(directory, "picture.png"));
        const second = await concept.replaceTreeFromDirectory({ name: "content", directory });
        expect(second).toMatchObject({
          status: "loaded",
          root: first.root,
          count: 1,
          changed: true,
        });
        expect(concept._at({ root: first.root, path: "posts/page.md" })[0]?.file).toBe(page);
        expect(concept._file({ file: picture })).toEqual([]);
        expect(concept._text({ file: page })).toEqual([{ text: "second\n" }]);

        await symlink(outside, join(directory, "linked"));
        expect(await concept.replaceTreeFromDirectory({ name: "content", directory })).toEqual({
          status: "problem",
          code: "ENTRY_UNSUPPORTED",
          detail: "Only directories and ordinary files may be loaded.",
        });
        expect(concept._text({ file: page })).toEqual([{ text: "second\n" }]);
      } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });

    test("loads one host file without changing the prior tree on a problem", async () => {
      const directory = await mkdtemp(join(tmpdir(), "filing-file-"));
      try {
        const source = join(directory, "site.yaml");
        await writeFile(source, "title: Ada\n");
        const concept = create();
        const loaded = await concept.replaceTreeFromFile({
          name: "project",
          source,
          path: "site.yaml",
        });
        expect(loaded).toMatchObject({ status: "loaded", count: 1, changed: true });
        if (loaded.status !== "loaded" || loaded.file === undefined) {
          throw new Error(loaded.detail ?? "loaded tree has no file");
        }
        expect(concept._text({ file: loaded.file })).toEqual([{ text: "title: Ada\n" }]);
        expect(
          await concept.replaceTreeFromFile({
            name: "project",
            source: join(directory, "missing"),
            path: "site.yaml",
          }),
        ).toEqual({
          status: "problem",
          code: "FILE_MISSING",
          detail: "This required file is missing.",
        });
        expect(concept._text({ file: loaded.file })).toEqual([{ text: "title: Ada\n" }]);
        await expect(
          concept.replaceTreeFromFile({ name: "", source, path: "site.yaml" }),
        ).rejects.toBeInstanceOf(InvalidSource);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    test("copies bytes, keeps address identity, and reports exact change", () => {
      const concept = create();
      const root = concept.ensureRoot({ name: "content" }).root;
      expect(concept.ensureRoot({ name: "content" })).toEqual({ root });
      const input = Buffer.from("first");
      const first = concept.putFile({ root, path: "posts/page.md", content: input });
      input.fill(0);
      expect(text(concept._file({ file: first.file })[0]!.content)).toBe("first");

      const observed = concept._file({ file: first.file })[0]!.content;
      observed.fill(0);
      expect(text(concept._file({ file: first.file })[0]!.content)).toBe("first");
      expect(concept.putFile({ root, path: "posts/page.md", content: bytes("first") })).toEqual({
        file: first.file,
        digest: first.digest,
        changed: false,
      });
      const changed = concept.putFile({
        root,
        path: "posts/page.md",
        content: bytes("second"),
      });
      expect(changed).toMatchObject({ file: first.file, changed: true });
      expect(concept._under({ root, prefix: "posts" })).toEqual([
        { file: first.file, path: "posts/page.md", digest: changed.digest },
      ]);

      expect(concept.discard({ file: first.file })).toEqual({
        root,
        path: "posts/page.md",
        name: "page.md",
      });
      expect(() => concept.discard({ file: first.file })).toThrow(FileNotFound);
      expect(concept.putFile({ root, path: "posts/page.md", content: bytes("second") }).file).toBe(
        first.file,
      );
    });

    test("enforces root and portable path ownership", () => {
      const concept = create();
      const root = concept.ensureRoot({ name: "content" }).root;
      expect(() =>
        concept.putFile({ root: "missing", path: "page.md", content: bytes("x") }),
      ).toThrow(RootNotFound);
      for (const path of ["/absolute", "../escape", "a/../../escape"]) {
        expect(() => concept.putFile({ root, path, content: bytes("x") })).toThrow(PathLeavesRoot);
      }
      for (const path of ["", ".", "./page.md", "a/../page.md", "a//page.md", "a/"]) {
        expect(() => concept.putFile({ root, path, content: bytes("x") })).toThrow(InvalidPath);
      }
    });

    test("decodes strict UTF-8 and canonical Base64 without exposing retained bytes", () => {
      const concept = create();
      const root = concept.ensureRoot({ name: "content" }).root;
      const supplied = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes("Ada — café")]);
      const page = concept.putFile({ root, path: "page.md", content: supplied });
      supplied.fill(0);
      expect(concept._text({ file: page.file })).toEqual([{ text: "\uFEFFAda — café" }]);

      const malformed = concept.putFile({
        root,
        path: "bad.txt",
        content: Uint8Array.from([0xed, 0xa0, 0x80]),
      });
      expect(concept._text({ file: malformed.file })).toEqual([]);

      const binary = Uint8Array.from([0, 1, 127, 128, 255]);
      const placed = concept.putBase64File({
        root,
        path: "binary.bin",
        encoded: Buffer.from(binary).toString("base64"),
      });
      expect(concept._file({ file: placed.file })[0]?.content).toEqual(binary);
      for (const encoded of ["not base64", "AA", 1]) {
        expect(() =>
          concept.putBase64File({ root, path: "invalid.bin", encoded: encoded as string }),
        ).toThrow(InvalidEncoding);
      }
    });

    test("resolves only local references inside one logical root", () => {
      const concept = create();
      const root = concept.ensureRoot({ name: "content" }).root;
      const page = concept.putFile({ root, path: "posts/page.md", content: bytes("page") });
      const picture = concept.putFile({
        root,
        path: "posts/picture one.png",
        content: bytes("image"),
      });
      const shared = concept.putFile({ root, path: "shared.bin", content: bytes("shared") });

      expect(
        concept._resolve({ file: page.file, address: "./picture%20one.png?download=1#preview" }),
      ).toEqual([{ target: picture.file, path: "posts/picture one.png" }]);
      expect(concept._resolve({ file: page.file, address: "../shared.bin" })).toEqual([
        { target: shared.file, path: "shared.bin" },
      ]);
      expect(concept._resolution({ file: page.file, address: "../../escape" })).toEqual({
        status: "outside",
      });
      expect(concept._resolution({ file: page.file, address: "/absolute" })).toEqual({
        status: "nonlocal",
      });
      expect(concept._resolution({ file: page.file, address: "./missing" })).toEqual({
        status: "missing",
      });
      expect(concept._resolution({ file: "missing", address: "./x" })).toEqual({
        status: "unknown-file",
      });
    });
  });
}
