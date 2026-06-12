// Task A solver — CORRECT implementation of the public spec (plan §5.5A):
// lowercase, NFKD strip diacritics, non-alphanumeric runs -> single "-",
// trim "-", empty -> "".
//
// IMPORTANT: this file is fully standalone (no imports). The worker uploads the
// raw source of this file as the deliverable artifact; the validator's hidden
// suite imports it as `./solution` and expects the named export `slugify`.

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs -> single "-"
    .replace(/^-+|-+$/g, ""); // trim leading/trailing "-"
}
