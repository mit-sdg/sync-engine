import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogListing, listingPath } from "./catalog-listing.ts";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, listingPath);
const projected = await catalogListing(root);
const current = await readFile(target, "utf8").catch(() => "");

if (projected === current) {
  console.log("catalog listing already current");
} else {
  await writeFile(target, projected);
  console.log(`updated ${listingPath}`);
}
