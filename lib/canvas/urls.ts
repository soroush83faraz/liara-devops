// Public URL of an app. [VAL] The default sub-domain suffix is the one shown in Liara's console; confirm live.
export const DEFAULT_APP_DOMAIN_SUFFIX = "liara.run";

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export function isValidAppName(name: string): boolean {
  return APP_NAME_RE.test(name);
}

/** `https://<name>.liara.run`, or undefined when the name cannot be a DNS label. */
export function defaultAppUrl(name: string): string | undefined {
  return isValidAppName(name) ? `https://${name.toLowerCase()}.${DEFAULT_APP_DOMAIN_SUFFIX}` : undefined;
}
