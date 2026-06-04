export interface FoundryCredential {
  _id: string;
  hostname: string;
  password: string;
  /** Login identity — the bridge user's display name (preferred, stable across
   * worlds), a list of candidate names, or the legacy user document _id. At
   * least one must be present. */
  username?: string;
  usernames?: string[];
  userid?: string;
}

export interface CredentialInfo {
  _id: string;
  hostname: string;
  /** The login identity (username / usernames / legacy userid). */
  user: string;
  item_order: number;
  currently_active: boolean;
}

/** The configured login identity for display (never the password). */
function credentialUser(cred: FoundryCredential): string | undefined {
  if (typeof cred.username === "string") return cred.username;
  if (Array.isArray(cred.usernames) && cred.usernames.length) return cred.usernames.join("/");
  return cred.userid;
}

export function parseCredentials(raw: string): FoundryCredential[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Credentials JSON must be an array");
  }
  for (const entry of parsed) {
    const c = entry as FoundryCredential;
    const hasIdentity =
      typeof c?.username === "string" ||
      (Array.isArray(c?.usernames) && c.usernames.every((n) => typeof n === "string")) ||
      typeof c?.userid === "string";
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof c._id !== "string" ||
      typeof c.hostname !== "string" ||
      typeof c.password !== "string" ||
      !hasIdentity
    ) {
      throw new Error(
        "Credentials JSON entries must have _id, hostname, password strings and a login identity (username, usernames, or userid)",
      );
    }
  }
  return parsed as FoundryCredential[];
}

export function getCredentialsInfo(
  credentials: FoundryCredential[],
  activeIndex: number,
): CredentialInfo[] {
  return credentials.map((cred, index) => ({
    _id: cred._id,
    hostname: cred.hostname,
    user: credentialUser(cred) ?? "",
    item_order: index,
    currently_active: index === activeIndex,
  }));
}

export function resolveCredentialIndex(
  credentials: FoundryCredential[],
  identifier: { item_order?: number; _id?: string },
): number {
  if (identifier.item_order !== undefined) {
    if (
      identifier.item_order < 0 ||
      identifier.item_order >= credentials.length
    ) {
      throw new Error(
        `Invalid item_order: ${identifier.item_order}. Valid range is 0-${
          credentials.length - 1
        }`,
      );
    }
    return identifier.item_order;
  }

  if (identifier._id !== undefined) {
    const index = credentials.findIndex((cred) => cred._id === identifier._id);
    if (index === -1) {
      const validIds = credentials.map((cred) => cred._id).join(", ");
      throw new Error(
        `No credential found with _id: "${identifier._id}". Valid _ids are: ${validIds}`,
      );
    }
    return index;
  }

  throw new Error("Must provide either item_order or _id");
}
