import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { {{App}}Wire } from "../generated/wire.ts";
import { build{{App}} } from "./edge.ts";

const { gateway } = build{{App}}();
const notes = createLocalClient<{{App}}Wire>({ invoker: gateway });

const written = await notes.notes.write({ text: "buy milk" });
if ("error" in written) throw new Error(String(written.error));
const read = await notes.notes.get({ note: written.note });
if ("error" in read) throw new Error(String(read.error));
console.log(JSON.stringify(read.page));
