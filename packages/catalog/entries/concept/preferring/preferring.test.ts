import { PreferringConcept, PreferenceNotFound } from "./preferring.ts";

const values = ["theme", "other-scope", "density", "other-owner", "left", "right"];
const preferring = new PreferringConcept(() => values.shift() ?? "unexpected");
const first = preferring.set({ owner: "Mina", scope: "workshop", key: "theme", value: "dark" });
preferring.set({ owner: "Mina", scope: "other", key: "theme", value: "blue" });
preferring.set({ owner: "Mina", scope: "workshop", key: "density", value: "compact" });
const replaced = preferring.set({
  owner: "Mina",
  scope: "workshop",
  key: "theme",
  value: "light",
});
if (replaced.preference !== first.preference) {
  throw new Error("Replacing a preference changed its identity.");
}
const ordered = preferring
  ._all({ owner: "Mina" })
  .map(({ preference, value }) => `${preference}:${value}`)
  .join(",");
if (ordered !== "theme:light,other-scope:blue,density:compact") {
  throw new Error("Replacing a preference changed its first-set order.");
}

preferring.set({ owner: "Jo", scope: "workshop", key: "theme", value: "dark" });
if (
  preferring._get({ owner: "Mina", scope: "workshop", key: "theme" })[0]?.value !== "light" ||
  preferring._get({ owner: "Jo", scope: "workshop", key: "theme" })[0]?.value !== "dark" ||
  preferring._get({ owner: "Mina", scope: "other", key: "theme" })[0]?.value !== "blue"
) {
  throw new Error("Owners or scopes did not retain isolated preferences.");
}

const left = preferring.set({ owner: "A|B", scope: "C", key: "D", value: "left" });
const right = preferring.set({ owner: "A", scope: "B|C", key: "D", value: "right" });
if (
  preferring._get({ owner: "A|B", scope: "C", key: "D" })[0]?.preference !== left.preference ||
  preferring._get({ owner: "A", scope: "B|C", key: "D" })[0]?.preference !== right.preference
) {
  throw new Error("Delimiter-bearing preference fields collided.");
}

if (!preferring._matches({ owner: "Mina", scope: "workshop", key: "theme", value: "light" }).matches) {
  throw new Error("An exact preference did not match.");
}
if (preferring._matches({ owner: "Mina", scope: "workshop", key: "theme", value: "dark" }).matches) {
  throw new Error("A different preference value matched.");
}
if (preferring._matches({ owner: "Mina", scope: "workshop", key: "missing", value: "light" }).matches) {
  throw new Error("An absent preference matched.");
}

const cleared = preferring.clear({ owner: "Mina", scope: "workshop", key: "theme" });
if (cleared.preference !== first.preference) throw new Error("Clear returned the wrong preference.");
if (preferring._get({ owner: "Mina", scope: "workshop", key: "theme" }).length !== 0) {
  throw new Error("A cleared preference remained readable.");
}
const afterClear = JSON.stringify(preferring._all({ owner: "Mina" }));
try {
  preferring.clear({ owner: "Mina", scope: "workshop", key: "theme" });
  throw new Error("A missing preference was cleared twice.");
} catch (error) {
  if (!(error instanceof PreferenceNotFound)) throw error;
}
if (JSON.stringify(preferring._all({ owner: "Mina" })) !== afterClear) {
  throw new Error("A refused clear changed preference state.");
}

const colliding = new PreferringConcept(() => "same-preference");
colliding.set({ owner: "Mina", scope: "appearance", key: "theme", value: "dark" });
const collisionState = JSON.stringify(colliding._all({ owner: "Mina" }));
try {
  colliding.set({ owner: "Mina", scope: "appearance", key: "density", value: "compact" });
  throw new Error("A duplicate generated preference identity was accepted.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Generated preference identity already exists.") {
    throw error;
  }
}
if (JSON.stringify(colliding._all({ owner: "Mina" })) !== collisionState) {
  throw new Error("A generated identity collision changed preference state.");
}

const invalidIdentity = new PreferringConcept(() => "p".repeat(129));
try {
  invalidIdentity.set({ owner: "Mina", scope: "appearance", key: "theme", value: "dark" });
  throw new Error("An oversized generated preference identity was accepted.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated preference identity must be 1-128 characters."
  ) {
    throw error;
  }
}
if (invalidIdentity._all({ owner: "Mina" }).length !== 0) {
  throw new Error("An invalid generated identity changed preference state.");
}
console.log("Preferring principle holds");
