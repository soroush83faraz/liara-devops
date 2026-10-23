/** True when the typed text equals the resource name exactly (surrounding whitespace from paste is ignored). */
export function matchesName(input: string, name: string): boolean {
  return name.length > 0 && input.trim() === name;
}
