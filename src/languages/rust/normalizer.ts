import type Parser from "web-tree-sitter";
import type {
  LanguageNormalizer,
  NormalizerResult,
  ImportInfo,
  ExportInfo,
  SymbolInfo,
  SymbolKind,
  Visibility,
} from "../types.js";

type SyntaxNode = Parser.SyntaxNode;

function extractImports(root: SyntaxNode): ImportInfo[] {
  const imports: ImportInfo[] = [];
  collectUseDecls(root, imports);
  return imports;
}

function collectUseDecls(node: SyntaxNode, imports: ImportInfo[]): void {
  for (const child of node.children) {
    if (child.type === "use_declaration") {
      const arg = child.namedChildren.find(
        (c) =>
          c.type === "scoped_identifier" ||
          c.type === "use_wildcard" ||
          c.type === "use_list" ||
          c.type === "use_as_clause" ||
          c.type === "identifier" ||
          c.type === "scoped_use_list",
      );
      if (arg) {
        const specifier = arg.text;
        imports.push({
          rawSpecifier: specifier,
          kind: "static",
          importedSymbols: ["*"],
        });
      }
    }
  }
}

function extractSymbols(root: SyntaxNode, source: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];

  for (const child of root.children) {
    const sym = nodeToSymbol(child, source);
    if (sym) symbols.push(sym);
  }

  return symbols;
}

function nodeToSymbol(node: SyntaxNode, source: string): SymbolInfo | null {
  let kind: SymbolKind;
  let name: string;
  let visibility: Visibility;
  const isPub = node.children.some((c) => c.type === "visibility_modifier");

  switch (node.type) {
    case "function_item":
      kind = "function";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "struct_item":
      kind = "struct";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "enum_item":
      kind = "enum";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "trait_item":
      kind = "trait";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "impl_item":
      kind = "impl";
      name = node.childForFieldName("type")?.text ?? "";
      visibility = "public";
      break;
    case "type_item":
      kind = "type";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "const_item":
    case "static_item":
      kind = "variable";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    case "mod_item":
      kind = "module";
      name = node.childForFieldName("name")?.text ?? "";
      visibility = isPub ? "public" : "private";
      break;
    default:
      return null;
  }

  if (!name) return null;

  const sig = getSignature(node, source);

  return {
    kind,
    name,
    visibility,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: sig,
  };
}

function getSignature(node: SyntaxNode, source: string): string {
  const start = node.startIndex;
  const text = source.slice(start);
  const braceIdx = text.indexOf("{");
  const end = braceIdx >= 0 ? braceIdx : Math.min(text.length, 200);
  let sig = text.slice(0, end).trim();
  if (sig.length > 200) sig = sig.slice(0, 200) + "...";
  return sig;
}

export const rustNormalizer: LanguageNormalizer = {
  languages: ["rust"],

  normalize(tree: Parser.Tree, source: string): NormalizerResult {
    const root = tree.rootNode;
    const syms = extractSymbols(root, source);
    const publicNames = syms.filter((s) => s.visibility === "public").map((s) => s.name);

    return {
      imports: extractImports(root),
      exports:
        publicNames.length > 0
          ? [{ kind: "named", exportedSymbols: publicNames }]
          : [],
      symbols: syms,
    };
  },
};
