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

function getDocstring(node: SyntaxNode): string | undefined {
  // First child of the body is the docstring
  const body = node.childForFieldName("body");
  if (!body) return undefined;
  const first = body.firstNamedChild;
  if (first?.type === "expression_statement") {
    const expr = first.firstNamedChild;
    if (expr?.type === "string" || expr?.type === "concatenated_string") {
      const text = expr.text;
      return text.length > 500 ? text.slice(0, 500) + "..." : text;
    }
  }
  return undefined;
}

function getDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = [];
  // Decorated definition wraps the actual node
  const parent = node.parent;
  if (parent?.type === "decorated_definition") {
    for (const child of parent.children) {
      if (child.type === "decorator") {
        const text = child.text;
        decorators.push(text.length > 100 ? text.slice(0, 100) : text);
      }
    }
  }
  return decorators;
}

function extractImports(root: SyntaxNode): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const node of root.children) {
    if (node.type === "import_statement") {
      // import foo, import foo.bar
      const names: string[] = [];
      for (const child of node.namedChildren) {
        if (child.type === "dotted_name" || child.type === "aliased_import") {
          const name =
            child.type === "aliased_import"
              ? textOf(child.childForFieldName("name"))
              : child.text;
          names.push(name);
        }
      }
      for (const name of names) {
        imports.push({
          rawSpecifier: name,
          kind: "static",
          importedSymbols: ["*"],
        });
      }
    } else if (node.type === "import_from_statement") {
      // from foo import bar, baz
      const moduleNode = node.childForFieldName("module_name");
      const specifier = moduleNode?.text ?? "";
      const symbols: string[] = [];

      for (const child of node.namedChildren) {
        if (child.type === "dotted_name" && child !== moduleNode) {
          symbols.push(child.text);
        } else if (child.type === "aliased_import") {
          const name = child.childForFieldName("name");
          symbols.push(textOf(name));
        } else if (child.type === "wildcard_import") {
          symbols.push("*");
        }
      }

      if (symbols.length === 0) symbols.push("*");

      imports.push({
        rawSpecifier: specifier,
        kind: "static",
        importedSymbols: symbols,
      });
    }
  }

  return imports;
}

function extractExports(root: SyntaxNode): ExportInfo[] {
  // Python doesn't have explicit exports. We treat top-level public names
  // (not starting with _) as exports, and __all__ if defined.
  const exports: ExportInfo[] = [];
  const publicNames: string[] = [];

  for (const node of root.children) {
    const target =
      node.type === "decorated_definition"
        ? node.namedChildren.find(
            (c) =>
              c.type === "function_definition" ||
              c.type === "class_definition",
          )
        : node;
    if (!target) continue;

    if (
      target.type === "function_definition" ||
      target.type === "class_definition"
    ) {
      const name = textOf(target.childForFieldName("name"));
      if (name && !name.startsWith("_")) {
        publicNames.push(name);
      }
    } else if (
      target.type === "expression_statement" ||
      target.type === "assignment"
    ) {
      // Check for __all__ = [...]
      const assign =
        target.type === "assignment"
          ? target
          : target.firstNamedChild?.type === "assignment"
            ? target.firstNamedChild
            : null;
      if (assign) {
        const left = assign.childForFieldName("left");
        if (left?.text === "__all__") {
          const right = assign.childForFieldName("right");
          if (right?.type === "list") {
            for (const elem of right.namedChildren) {
              if (elem.type === "string") {
                const val = elem.text.replace(/['"]/g, "");
                if (val) publicNames.push(val);
              }
            }
          }
        }
      }
    }
  }

  if (publicNames.length > 0) {
    exports.push({ kind: "named", exportedSymbols: publicNames });
  }

  return exports;
}

function extractSymbols(root: SyntaxNode, source: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];

  for (const node of root.children) {
    const target =
      node.type === "decorated_definition"
        ? node.namedChildren.find(
            (c) =>
              c.type === "function_definition" ||
              c.type === "class_definition",
          )
        : node;
    if (!target) continue;

    const sym = nodeToSymbol(target, source);
    if (sym) symbols.push(sym);
  }

  return symbols;
}

function nodeToSymbol(
  node: SyntaxNode,
  source: string,
): SymbolInfo | null {
  let kind: SymbolKind;
  let name: string;
  let visibility: Visibility;
  let signature: string | undefined;

  switch (node.type) {
    case "function_definition":
      kind = "function";
      name = textOf(node.childForFieldName("name"));
      visibility = name.startsWith("_")
        ? name.startsWith("__") && name.endsWith("__")
          ? "public" // dunder methods
          : "private"
        : "public";
      signature = extractSignature(node, source);
      break;

    case "class_definition":
      kind = "class";
      name = textOf(node.childForFieldName("name"));
      visibility = name.startsWith("_") ? "private" : "public";
      signature = extractSignature(node, source);
      break;

    case "expression_statement": {
      const assign = node.firstNamedChild;
      if (assign?.type !== "assignment") return null;
      const left = assign.childForFieldName("left");
      if (!left || left.type !== "identifier") return null;
      name = left.text;
      kind = "variable";
      visibility = name.startsWith("_") ? "private" : "public";
      break;
    }

    default:
      return null;
  }

  if (!name) return null;

  const docComment = getDocstring(node);
  const decorators = getDecorators(node);
  const typeAnnotations = extractPythonTypeAnnotations(node);

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
  const start = node.startIndex;
  const text = source.slice(start);
  const colonIdx = text.indexOf(":");
  const newlineIdx = text.indexOf("\n");
  let end = Math.min(
    colonIdx >= 0 ? colonIdx + 1 : text.length,
    newlineIdx >= 0 ? newlineIdx : text.length,
  );
  // For multiline signatures with parameters
  if (colonIdx > newlineIdx && colonIdx >= 0) {
    end = colonIdx + 1;
  }
  let sig = text.slice(0, end).trim();
  if (sig.length > 200) sig = sig.slice(0, 200) + "...";
  return sig;
}

function extractPythonTypeAnnotations(node: SyntaxNode): string[] {
  const types: string[] = [];
  collectTypeHints(node, types, 0);
  return [...new Set(types)].slice(0, 20);
}

function collectTypeHints(
  node: SyntaxNode,
  types: string[],
  depth: number,
): void {
  if (depth > 5) return;
  if (node.type === "type") {
    const text = node.text;
    // Extract base type names, skip builtins
    const builtins = [
      "str", "int", "float", "bool", "None", "bytes", "list", "dict",
      "set", "tuple", "Any", "Optional", "Union", "List", "Dict",
    ];
    if (!builtins.includes(text)) {
      types.push(text.length > 50 ? text.slice(0, 50) : text);
    }
  }
  for (const child of node.children) {
    collectTypeHints(child, types, depth + 1);
  }
}

export const pythonNormalizer: LanguageNormalizer = {
  languages: ["python"],

  normalize(tree: Parser.Tree, source: string): NormalizerResult {
    const root = tree.rootNode;
    return {
      imports: extractImports(root),
      exports: extractExports(root),
      symbols: extractSymbols(root, source),
    };
  },
};
