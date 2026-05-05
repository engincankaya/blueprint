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

  for (const child of root.children) {
    if (child.type === "import_declaration") {
      // Remove the trailing semicolon and "import" keyword
      const text = child.text.replace(/^import\s+/, "").replace(/;\s*$/, "").trim();
      const isStatic = text.startsWith("static ");
      const specifier = isStatic ? text.replace(/^static\s+/, "") : text;
      const isWildcard = specifier.endsWith(".*");

      imports.push({
        rawSpecifier: specifier,
        kind: "static",
        importedSymbols: isWildcard ? ["*"] : [specifier.split(".").pop() ?? "*"],
      });
    }
  }

  return imports;
}

function getVisibility(node: SyntaxNode): Visibility {
  const modifiers = node.childForFieldName("modifiers") ??
    node.children.find((c) => c.type === "modifiers");
  if (!modifiers) return "unknown";

  const text = modifiers.text;
  if (text.includes("public")) return "public";
  if (text.includes("private")) return "private";
  if (text.includes("protected")) return "protected";
  return "internal";
}

function getAnnotations(node: SyntaxNode): string[] {
  const annotations: string[] = [];
  const modifiers = node.childForFieldName("modifiers") ??
    node.children.find((c) => c.type === "modifiers");
  if (!modifiers) return annotations;

  for (const child of modifiers.children) {
    if (child.type === "marker_annotation" || child.type === "annotation") {
      const text = child.text;
      annotations.push(text.length > 100 ? text.slice(0, 100) : text);
    }
  }
  return annotations;
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

  switch (node.type) {
    case "class_declaration":
      kind = "class";
      name = node.childForFieldName("name")?.text ?? "";
      break;
    case "interface_declaration":
      kind = "interface";
      name = node.childForFieldName("name")?.text ?? "";
      break;
    case "enum_declaration":
      kind = "enum";
      name = node.childForFieldName("name")?.text ?? "";
      break;
    case "method_declaration":
      kind = "function";
      name = node.childForFieldName("name")?.text ?? "";
      break;
    case "constructor_declaration":
      kind = "function";
      name = node.childForFieldName("name")?.text ?? "constructor";
      break;
    case "field_declaration":
      kind = "variable";
      name = "";
      for (const child of node.namedChildren) {
        if (child.type === "variable_declarator") {
          name = child.childForFieldName("name")?.text ?? "";
          break;
        }
      }
      break;
    default:
      return null;
  }

  if (!name) return null;

  const visibility = getVisibility(node);
  const annotations = getAnnotations(node);
  const sig = getSignature(node, source);

  return {
    kind,
    name,
    visibility,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: sig,
    decorators: annotations.length > 0 ? annotations : undefined,
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

export const javaNormalizer: LanguageNormalizer = {
  languages: ["java"],

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
