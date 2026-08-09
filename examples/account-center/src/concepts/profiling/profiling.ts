export class DisplayNameRequired extends Error {}
export class ProfileAlreadyExists extends Error {}
export class ProfileNotFound extends Error {}

export type Profile = { profile: string; principal: string; displayName: string };

function requireDisplayName(displayName: string): void {
  if (displayName.trim() === "") throw new DisplayNameRequired();
}

function generatedProfile(freshID: () => string): string {
  const profile = freshID();
  if (profile.length < 1 || profile.length > 128) {
    throw new Error("Generated profile identity must be 1-128 characters.");
  }
  return profile;
}

/** Maintain one display profile for each opaque external principal. */
export class ProfilingConcept {
  private readonly profiles = new Map<string, Profile>();
  private readonly profilesByPrincipal = new Map<string, string>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  create({ principal, displayName }: { principal: string; displayName: string }) {
    requireDisplayName(displayName);
    const profile = generatedProfile(this.freshID);
    if (this.profilesByPrincipal.has(principal)) throw new ProfileAlreadyExists();
    if (this.profiles.has(profile)) throw new Error("Generated profile identity already exists.");
    this.profiles.set(profile, { profile, principal, displayName });
    this.profilesByPrincipal.set(principal, profile);
    return { profile };
  }

  rename({ profile, displayName }: { profile: string; displayName: string }) {
    const found = this.profiles.get(profile);
    if (found === undefined) throw new ProfileNotFound();
    requireDisplayName(displayName);
    this.profiles.set(profile, { ...found, displayName });
    return { profile };
  }

  _get({ profile }: { profile: string }): { principal: string; displayName: string }[] {
    const found = this.profiles.get(profile);
    return found === undefined
      ? []
      : [{ principal: found.principal, displayName: found.displayName }];
  }

  _forPrincipal({ principal }: { principal: string }): { profile: string; displayName: string }[] {
    const profile = this.profilesByPrincipal.get(principal);
    const found = profile === undefined ? undefined : this.profiles.get(profile);
    return found === undefined ? [] : [{ profile: found.profile, displayName: found.displayName }];
  }
}
