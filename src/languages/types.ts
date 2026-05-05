import type Parser from "web-tree-sitter";

export type SymbolKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "struct"
  | "trait"
  | "impl"
  | "module"
  | "other";

export type Visibility =
  | "public"
  | "private"
  | "protected"
  | "internal"
  | "unknown";

export interface ImportInfo {
  rawSpecifier: string;
  kind: "static" | "dynamic";
  importedSymbols: string[];
}

export interface ExportInfo {
  kind: "named" | "default" | "re-export";
  exportedSymbols: string[];
  fromSpecifier?: string;
}

export interface SymbolInfo {
  kind: SymbolKind;
  name: string;
  visibility: Visibility;
  startLine: number;
  endLine: number;
  // detailed fields
  signature?: string;
  decorators?: string[];
  typeAnnotations?: string[];
  docComment?: string;
}

export interface NormalizerResult {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
}

export interface LanguageNormalizer {
  /** Languages this normalizer handles (e.g. ["typescript", "tsx", "javascript"]) */
  languages: string[];
  /** Extract structural facts from a parsed AST */
  normalize(tree: Parser.Tree, source: string): NormalizerResult;
}
