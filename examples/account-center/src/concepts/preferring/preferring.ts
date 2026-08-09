export class PreferenceNotFound extends Error {}

type Preference = {
  preference: string;
  owner: string;
  scope: string;
  key: string;
  value: string;
};

function generatedPreference(freshID: () => string): string {
  const preference = freshID();
  if (preference.length < 1 || preference.length > 128) {
    throw new Error("Generated preference identity must be 1-128 characters.");
  }
  return preference;
}

/** Keep ordered, scoped key-value preferences for each owner. */
export class PreferringConcept {
  private readonly preferences = new Map<string, Map<string, Map<string, Preference>>>();
  private readonly ordered: Preference[] = [];
  private readonly usedIdentities = new Set<string>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  set({ owner, scope, key, value }: { owner: string; scope: string; key: string; value: string }) {
    const found = this.#preference(owner, scope, key);
    if (found !== undefined) {
      found.value = value;
      return { preference: found.preference };
    }

    const preference = generatedPreference(this.freshID);
    if (this.usedIdentities.has(preference)) {
      throw new Error("Generated preference identity already exists.");
    }

    let scopes = this.preferences.get(owner);
    if (scopes === undefined) {
      scopes = new Map();
      this.preferences.set(owner, scopes);
    }
    let keys = scopes.get(scope);
    if (keys === undefined) {
      keys = new Map();
      scopes.set(scope, keys);
    }

    const entry = { preference, owner, scope, key, value };
    keys.set(key, entry);
    this.ordered.push(entry);
    this.usedIdentities.add(preference);
    return { preference };
  }

  clear({ owner, scope, key }: { owner: string; scope: string; key: string }) {
    const scopes = this.preferences.get(owner);
    const keys = scopes?.get(scope);
    const found = keys?.get(key);
    if (scopes === undefined || keys === undefined || found === undefined) {
      throw new PreferenceNotFound();
    }

    keys.delete(key);
    if (keys.size === 0) scopes.delete(scope);
    if (scopes.size === 0) this.preferences.delete(owner);
    const index = this.ordered.indexOf(found);
    if (index !== -1) this.ordered.splice(index, 1);
    return { preference: found.preference };
  }

  _get({ owner, scope, key }: { owner: string; scope: string; key: string }) {
    const found = this.#preference(owner, scope, key);
    return found === undefined ? [] : [{ preference: found.preference, value: found.value }];
  }

  _all({ owner }: { owner: string }) {
    return this.ordered
      .filter((preference) => preference.owner === owner)
      .map(({ preference, scope, key, value }) => ({ preference, scope, key, value }));
  }

  _matches({
    owner,
    scope,
    key,
    value,
  }: {
    owner: string;
    scope: string;
    key: string;
    value: string;
  }): { matches: boolean } {
    const found = this.#preference(owner, scope, key);
    return { matches: found !== undefined && found.value === value };
  }

  #preference(owner: string, scope: string, key: string): Preference | undefined {
    return this.preferences.get(owner)?.get(scope)?.get(key);
  }
}
