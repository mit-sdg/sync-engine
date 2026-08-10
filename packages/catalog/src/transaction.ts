import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PlannedFile } from "./types.ts";
import { within } from "./paths.ts";

export interface TransactionFilesystem {
  exists(path: string): boolean;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}
const filesystem: TransactionFilesystem = { exists: existsSync, mkdir, writeFile, rename, rm };
interface Replacement {
  target: string;
  temporary: string;
  backup?: string;
  installed: boolean;
}

/** Applies staged source replacements, then makes the new lock visible last. */
export async function applyTransaction(
  root: string,
  files: readonly PlannedFile[],
  lockSource: string,
  fs: TransactionFilesystem = filesystem,
): Promise<void> {
  const transaction = `.catalog-${randomUUID()}`;
  const replacements: Replacement[] = [];
  try {
    for (const file of files) {
      const target = within(root, file.target);
      await fs.mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${transaction}.tmp`;
      await fs.writeFile(temporary, file.contents);
      replacements.push({ target, temporary, installed: false });
    }
    const lockTarget = resolve(root, "catalog.lock");
    const lockTemporary = `${lockTarget}.${transaction}.tmp`;
    await fs.writeFile(lockTemporary, lockSource);
    replacements.push({ target: lockTarget, temporary: lockTemporary, installed: false });
    for (const replacement of replacements) {
      if (fs.exists(replacement.target)) {
        replacement.backup = `${replacement.target}.${transaction}.bak`;
        await fs.rename(replacement.target, replacement.backup);
      }
      await fs.rename(replacement.temporary, replacement.target);
      replacement.installed = true;
    }
  } catch (error) {
    for (const replacement of [...replacements].reverse()) {
      if (replacement.installed) await fs.rm(replacement.target, { force: true }).catch(() => {});
      if (replacement.backup !== undefined && fs.exists(replacement.backup))
        await fs.rename(replacement.backup, replacement.target).catch(() => {});
      await fs.rm(replacement.temporary, { force: true }).catch(() => {});
    }
    throw error;
  }
  for (const replacement of replacements)
    if (replacement.backup !== undefined)
      await fs.rm(replacement.backup, { force: true }).catch(() => {});
}
