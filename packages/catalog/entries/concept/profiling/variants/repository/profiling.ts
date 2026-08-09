export class DisplayNameRequired extends Error {}
export class ProfileAlreadyExists extends Error {}
export class ProfileNotFound extends Error {}

export type Profile = { profile: string; principal: string; displayName: string };

/** Synchronous atomic storage contract required by the repository variant. */
export interface ProfileRepository {
  /** Return principal-exists when both the principal and generated identity conflict. */
  create(record: Profile): "created" | "principal-exists" | "identity-exists";
  rename(profile: string, displayName: string): "renamed" | "not-found";
  get(profile: string): Profile | undefined;
  forPrincipal(principal: string): Profile | undefined;
}

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

/** Maintain profiles while delegating state to an application repository. */
export class ProfilingConcept {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {}

  create({ principal, displayName }: { principal: string; displayName: string }) {
    requireDisplayName(displayName);
    const profile = generatedProfile(this.freshID);
    const result = this.repository.create({ profile, principal, displayName });
    if (result === "principal-exists") throw new ProfileAlreadyExists();
    if (result === "identity-exists") {
      throw new Error("Generated profile identity already exists.");
    }
    return { profile };
  }

  rename({ profile, displayName }: { profile: string; displayName: string }) {
    if (this.repository.get(profile) === undefined) throw new ProfileNotFound();
    requireDisplayName(displayName);
    if (this.repository.rename(profile, displayName) === "not-found") throw new ProfileNotFound();
    return { profile };
  }

  _get({ profile }: { profile: string }): { principal: string; displayName: string }[] {
    const found = this.repository.get(profile);
    return found === undefined
      ? []
      : [{ principal: found.principal, displayName: found.displayName }];
  }

  _forPrincipal({
    principal,
  }: {
    principal: string;
  }): { profile: string; displayName: string }[] {
    const found = this.repository.forPrincipal(principal);
    return found === undefined ? [] : [{ profile: found.profile, displayName: found.displayName }];
  }
}
