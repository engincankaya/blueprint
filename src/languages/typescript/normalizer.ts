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

function textOf(node: SyntaxNode | null): string {
  return node?.text ?? "";
}

function getDocComment(node: SyntaxNode, source: string): string | undefined {
  const prev = node.previousNamedSibling;
  if (prev?.type === "comment") {
    const text = prev.text;
    if (text.startsWith("/**") || text.startsWith("///")) {
      return text.length > 500 ? text.slice(0, 500) + "..." : text;
    }
  }
  return undefined;
}

function getDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = [];
  // Check parent for decorator nodes (export_statement wrapping)
  const parent = node.parent;
  const target = parent?.type === "export_statement" ? parent : node;

  let sibling = target.previousNamedSibling;
  while (sibling?.type === "decorator") {
    const name = sibling.childForFieldName("value")?.text ?? sibling.text;
    decorators.unshift(name.length > 100 ? name.slice(0, 100) : name);
    sibling = sibling.previousNamedSibling;
  }
  return decorators;
}

function extractImports(root: SyntaxNode): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const node of root.children) {
    if (node.type === "import_statement") {
      const source = node.childForFieldName("source");
      const specifier = textOf(source).replace(/['"]/g, "");
      if (!specifier) continue;

      const importedSymbols: string[] = [];
      const importClause = node.children.find(
        (c) =>
          c.type === "import_clause" ||
          c.type === "named_imports" ||
          c.type === "namespace_import",
      );

      if (importClause) {
        walkImportClause(importClause, importedSymbols);
      }

      // Handle: import "side-effect"
      if (importedSymbols.length === 0 && !importClause) {
        importedSymbols.push("*");
      }

      imports.push({ rawSpecifier: specifier, kind: "static", importedSymbols });
    }
  }

  // Find dynamic imports: import("...")
  collectDynamicImports(root, imports);

  return imports;
}

function walkImportClause(node: SyntaxNode, symbols: string[]): void {
  for (const child of node.children) {
    if (child.type === "identifier") {
      symbols.push(child.text);
    } else if (child.type === "namespace_import") {
      symbols.push("*");
    } else if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        if (spec.type === "import_specifier") {
          const name =
            spec.childForFieldName("alias")?.text ??
            spec.childForFieldName("name")?.text ??
            spec.text;
          symbols.push(name);
        }
      }
    } else if (child.type === "import_clause") {
      walkImportClause(child, symbols);
    }
  }
}

function collectDynamicImports(
  node: SyntaxNode,
  imports: ImportInfo[],
): void {
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn?.type === "import") {
      const args = node.childForFieldName("arguments");
      const firstArg = args?.firstNamedChild;
      if (firstArg?.type === "string" || firstArg?.type === "template_string") {
        const specifier = firstArg.text.replace(/['"`]/g, "");
        imports.push({
          rawSpecifier: specifier,
          kind: "dynamic",
          importedSymbols: ["*"],
        });
      }
    }
  }
  for (const child of node.children) {
    collectDynamicImports(child, imports);
  }
}

function extractExports(root: SyntaxNode): ExportInfo[] {
  const exports: ExportInfo[] = [];

  for (const node of root.children) {
    if (node.type === "export_statement") {
      const source = node.childForFieldName("source");
      const fromSpecifier = source
        ? textOf(source).replace(/['"]/g, "")
        : undefined;

      // export default ...
      if (node.children.some((c) => c.type === "default")) {
        const declChild = node.namedChildren.find(
          (c) =>
            c.type !== "comment" &&
            c.type !== "export_clause" &&
            c.text !== "default",
        );
        const name = declChild?.childForFieldName?.("name")?.text ?? "default";
        exports.push({
          kind: "default",
          exportedSymbols: [name],
          fromSpecifier,
        });
        continue;
      }

      // export { ... } or export { ... } from "..."
      const clause = node.children.find((c) => c.type === "export_clause");
      if (clause) {
        const symbols: string[] = [];
        for (const spec of clause.namedChildren) {
          if (spec.type === "export_specifier") {
            const alias =
              spec.childForFieldName("alias")?.text ??
              spec.childForFieldName("name")?.text ??
              spec.text;
            symbols.push(alias);
          }
        }
        exports.push({
          kind: fromSpecifier ? "re-export" : "named",
          exportedSymbols: symbols,
          fromSpecifier,
        });
        continue;
      }

      // export const/function/class/interface/type/enum ...
      const decl = node.namedChildren.find(
        (c) =>
          c.type.includes("declaration") ||
          c.type === "function_declaration" ||
          c.type === "class_declaration" ||
          c.type === "interface_declaration" ||
          c.type === "type_alias_declaration" ||
          c.type === "enum_declaration" ||
          c.type === "lexical_declaration",
      );
      if (decl) {
        const names = extractDeclNames(decl);
        if (names.length > 0) {
          exports.push({
            kind: "named",
            exportedSymbols: names,
            fromSpecifier,
          });
        }
      }
    }
  }

  return exports;
}

function extractDeclNames(node: SyntaxNode): string[] {
  const names: string[] = [];
  const nameNode = node.childForFieldName("name");
  if (nameNode) {
    names.push(nameNode.text);
    return names;
  }
  // lexical_declaration: const a = ..., b = ...
  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (const child of node.namedChildren) {
      if (child.type === "variable_declarator") {
        const n = child.childForFieldName("name");
        if (n) names.push(n.text);
      }
    }
  }
  return names;
}

function extractSymbols(root: SyntaxNode, source: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  collectSymbols(root, source, symbols, false);
  return symbols;
}

function collectSymbols(
  node: SyntaxNode,
  source: string,
  symbols: SymbolInfo[],
  insideExport: boolean,
): void {
  for (const child of node.children) {
    const isExport = child.type === "export_statement";
    const target = isExport ? child : child;
    const exported = insideExport || isExport;

    const sym = nodeToSymbol(target, source, exported);
    if (sym) {
      symbols.push(sym);
      continue; // don't recurse into the declaration itself
    }

    // For export statements, recurse into children
    if (isExport) {
      collectSymbols(child, source, symbols, true);
    }
  }
}

function nodeToSymbol(
  node: SyntaxNode,
  source: string,
  exported: boolean,
): SymbolInfo | null {
  let kind: SymbolKind;
  let name: string;
  let visibility: Visibility;
  let signature: string | undefined;

  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
      kind = "function";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      signature = extractSignature(node, source);
      break;

    case "class_declaration":
      kind = "class";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      signature = extractSignature(node, source);
      break;

    case "interface_declaration":
      kind = "interface";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      signature = extractSignature(node, source);
      break;

    case "type_alias_declaration":
      kind = "type";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      signature = extractSignature(node, source);
      break;

    case "enum_declaration":
      kind = "enum";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      break;

    case "lexical_declaration":
    case "variable_declaration": {
      const declarators = node.namedChildren.filter(
        (c) => c.type === "variable_declarator",
      );
      if (declarators.length === 0) return null;
      // For arrow functions / function expressions assigned to const
      const first = declarators[0];
      const nameNode = first.childForFieldName("name");
      if (!nameNode) return null;
      name = nameNode.text;
      const value = first.childForFieldName("value");
      if (
        value?.type === "arrow_function" ||
        value?.type === "function_expression" ||
        value?.type === "function"
      ) {
        kind = "function";
      } else {
        kind = "variable";
      }
      visibility = exported ? "public" : "internal";
      signature = extractSignature(node, source);
      break;
    }

    case "module": {
      kind = "module";
      name = textOf(node.childForFieldName("name"));
      visibility = exported ? "public" : "internal";
      break;
    }

    default:
      return null;
  }

  if (!name) return null;

  const docComment = getDocComment(node, source);
  const decorators = getDecorators(node);
  const typeAnnotations = extractTypeAnnotations(node);

  return {
    kind,
    name,
    visibility,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature,
    decorators: decorators.length > 0 ? decorators : undefined,
    typeAnnotations: typeAnnotations.length > 0 ? typeAnnotations : undefined,
    docComment,
  };
}

function extractSignature(node: SyntaxNode, source: string): string {
  // Get the first line of the declaration (up to { or =)
  const start = node.startIndex;
  const text = source.slice(start);
  const braceIdx = text.indexOf("{");
  const newlineIdx = text.indexOf("\n");
  let end = Math.min(
    braceIdx >= 0 ? braceIdx : text.length,
    newlineIdx >= 0 ? newlineIdx : text.length,
  );
  // For multiline signatures, find the opening brace
  if (braceIdx > newlineIdx && braceIdx >= 0) {
    end = braceIdx;
  }
  let sig = text.slice(0, end).trim();
  if (sig.length > 200) sig = sig.slice(0, 200) + "...";
  return sig;
}

function extractTypeAnnotations(node: SyntaxNode): string[] {
  const types: string[] = [];
  collectTypeRefs(node, types, 0);
  return [...new Set(types)].slice(0, 20);
}

function collectTypeRefs(
  node: SyntaxNode,
  types: string[],
  depth: number,
): void {
  if (depth > 5) return;
  if (
    node.type === "type_identifier" ||
    node.type === "generic_type" ||
    node.type === "predefined_type"
  ) {
    const name =
      node.type === "generic_type"
        ? textOf(node.firstChild)
        : node.text;
    if (
      name &&
      !["string", "number", "boolean", "void", "any", "unknown", "never", "null", "undefined"].includes(name)
    ) {
      types.push(name);
    }
    return;
  }
  for (const child of node.children) {
    collectTypeRefs(child, types, depth + 1);
  }
}

export const typescriptNormalizer: LanguageNormalizer = {
  languages: ["typescript", "tsx", "javascript"],

  normalize(tree: Parser.Tree, source: string): NormalizerResult {
    const root = tree.rootNode;
    return {
      imports: extractImports(root),
      exports: extractExports(root),
      symbols: extractSymbols(root, source),
    };
  },
};
