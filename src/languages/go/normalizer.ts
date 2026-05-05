import type Parser from "web-tree-sitter";
import type {
  LanguageNormalizer,
  NormalizerResult,
  ImportInfo,
  ExportInfo,
  SymbolInfo,
  SymbolKind,
} from "../types.js";

type SyntaxNode = Parser.SyntaxNode;

function extractImports(root: SyntaxNode): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const node of root.children) {
    if (node.type === "import_declaration") {
      for (const child of node.namedChildren) {
        if (child.type === "import_spec") {
          const path = child.childForFieldName("path")?.text.replace(/"/g, "") ?? "";
          if (path) {
            imports.push({ rawSpecifier: path, kind: "static", importedSymbols: ["*"] });
          }
        } else if (child.type === "import_spec_list") {
          for (const spec of child.namedChildren) {
            if (spec.type === "import_spec") {
              const path = spec.childForFieldName("path")?.text.replace(/"/g, "") ?? "";
              if (path) {
                const alias = spec.childForFieldName("name")?.text;
                imports.push({
                  rawSpecifier: path,
                  kind: "static",
                  importedSymbols: alias ? [alias] : ["*"],
                });
              }
            }
          }
        }
      }
    }
  }

  return imports;
}

function extractSymbols(root: SyntaxNode, source: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];

  for (const node of root.children) {
    let kind: SymbolKind | null = null;
    let name = "";

    switch (node.type) {
      case "function_declaration":
        kind = "function";
        name = node.childForFieldName("name")?.text ?? "";
        break;
      case "method_declaration":
        kind = "function";
        name = node.childForFieldName("name")?.text ?? "";
        break;
      case "type_declaration": {
        const spec = node.namedChildren.find((c) => c.type === "type_spec");
        if (spec) {
          const typeName = spec.childForFieldName("name")?.text ?? "";
          const typeVal = spec.childForFieldName("type");
          if (typeVal?.type === "struct_type") kind = "struct";
          else if (typeVal?.type === "interface_type") kind = "interface";
          else kind = "type";
          name = typeName;
        }
        break;
      }
      case "var_declaration":
      case "const_declaration": {
        for (const spec of node.namedChildren) {
          if (spec.type === "var_spec" || spec.type === "const_spec") {
            const n = spec.childForFieldName("name")?.text ?? "";
            if (n) {
              symbols.push({
                kind: "variable",
                name: n,
                visibility: n[0] === n[0].toUpperCase() ? "public" : "private",
                startLine: spec.startPosition.row + 1,
                endLine: spec.endPosition.row + 1,
              });
            }
          }
        }
        continue;
      }
      default:
        continue;
    }

    if (kind && name) {
      // Go: exported if first letter is uppercase
      const visibility = name[0] === name[0].toUpperCase() ? "public" as const : "private" as const;
      const sig = getSignature(node, source);

      symbols.push({
        kind,
        name,
        visibility,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        signature: sig,
      });
    }
  }

  return symbols;
}

function getSignature(node: SyntaxNode, source: string): string {
  const start = node.startIndex;
  const text = source.slice(start);
  const braceIdx = text.indexOf("{");
  const end = braceIdx >= 0 ? braceIdx : Math.min(text.indexOf("\n"), 200);
  let sig = text.slice(0, end >= 0 ? end : 200).trim();
  if (sig.length > 200) sig = sig.slice(0, 200) + "...";
  return sig;
}

export const goNormalizer: LanguageNormalizer = {
  languages: ["go"],

  normalize(tree: Parser.Tree, source: string): NormalizerResult {
    const root = tree.rootNode;
    // Go uses package-level exports (capitalized names)
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
