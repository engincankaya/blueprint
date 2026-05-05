import type { LanguageNormalizer } from "./types.js";
import { typescriptNormalizer } from "./typescript/normalizer.js";
import { pythonNormalizer } from "./python/normalizer.js";
import { goNormalizer } from "./go/normalizer.js";
import { rustNormalizer } from "./rust/normalizer.js";
import { javaNormalizer } from "./java/normalizer.js";

const ALL_NORMALIZERS: LanguageNormalizer[] = [
  typescriptNormalizer,
  pythonNormalizer,
  goNormalizer,
  rustNormalizer,
  javaNormalizer,
];

const registry = new Map<string, LanguageNormalizer>();

for (const normalizer of ALL_NORMALIZERS) {
  for (const lang of normalizer.languages) {
    registry.set(lang, normalizer);
  }
}

export function getNormalizer(language: string): LanguageNormalizer | undefined {
  return registry.get(language);
}

export function getSupportedParseLanguages(): string[] {
  return [...registry.keys()];
}
