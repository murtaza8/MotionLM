import type { NodePath, PluginObj } from "@babel/core";
import type { ImportDeclaration } from "@babel/types";
import * as t from "@babel/types";

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Normalises a POSIX-style path by resolving `.` and `..` segments. */
function normalizePath(raw: string): string {
  const parts = raw.split("/").filter((p) => p !== "");
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/**
 * Resolves a relative import source (e.g. `./components`) from
 * `currentFilePath` (e.g. `/main.tsx`) against the set of known VFS paths.
 *
 * Tries appending `.tsx`, `.ts`, `.jsx`, `.js` in that order.
 * Returns null if the import does not resolve to a VFS file.
 */
export function resolveVFSImport(
  importSource: string,
  currentFilePath: string,
  vfsPaths: Set<string>
): string | null {
  if (!importSource.startsWith(".")) return null;

  const dir = currentFilePath.includes("/")
    ? currentFilePath.slice(0, currentFilePath.lastIndexOf("/")) || "/"
    : "/";

  const base = normalizePath(`${dir}/${importSource}`);

  // Already has a known extension?
  if (vfsPaths.has(base)) return base;

  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = base + ext;
    if (vfsPaths.has(candidate)) return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Returns a Babel plugin that transforms relative VFS imports into
 * `__vfsRegistry__` lookups, leaving all non-VFS (package) imports alone so
 * the `importStripperPlugin` can remove them in the next pass.
 *
 * Example input (in /main.tsx):
 *   import { Title, Subtitle } from './components';
 *
 * Example output:
 *   const { Title, Subtitle } = __vfsRegistry__["/components.tsx"];
 *
 * The plugin is a zero-argument factory so it fits the Babel plugin array
 * convention alongside `importStripperPlugin` and `sourceMapPlugin`.
 */
export const makeVfsImportTransformerPlugin = (
  vfsPaths: Set<string>,
  currentFilePath: string
) =>
  (): PluginObj => ({
    visitor: {
      ImportDeclaration(path: NodePath<ImportDeclaration>) {
        const source = path.node.source.value;
        const resolved = resolveVFSImport(source, currentFilePath, vfsPaths);

        // Not a VFS import — leave for importStripperPlugin
        if (resolved === null) return;

        const specifiers = path.node.specifiers;

        // Side-effect import with no bindings: import './foo' — just remove
        if (specifiers.length === 0) {
          path.remove();
          return;
        }

        // Namespace import: import * as X from './foo'
        // → const X = __vfsRegistry__["/foo.tsx"]
        if (
          specifiers.length === 1 &&
          t.isImportNamespaceSpecifier(specifiers[0])
        ) {
          const decl = t.variableDeclaration("const", [
            t.variableDeclarator(
              t.identifier(specifiers[0].local.name),
              t.memberExpression(
                t.identifier("__vfsRegistry__"),
                t.stringLiteral(resolved),
                true // computed
              )
            ),
          ]);
          path.replaceWith(decl);
          return;
        }

        // Named / default specifiers:
        // import { X, Y as Z } from './foo' → const { X, Y: Z } = __vfsRegistry__["/foo.tsx"]
        const properties: (t.ObjectProperty | t.RestElement)[] = [];

        for (const spec of specifiers) {
          if (t.isImportSpecifier(spec)) {
            const importedName = t.isIdentifier(spec.imported)
              ? spec.imported.name
              : spec.imported.value;
            const localName = spec.local.name;

            properties.push(
              t.objectProperty(
                t.identifier(importedName),
                t.identifier(localName),
                false,
                importedName === localName // shorthand when names match
              )
            );
          } else if (t.isImportDefaultSpecifier(spec)) {
            // import X from './foo' → const { default: X } = ...
            properties.push(
              t.objectProperty(
                t.identifier("default"),
                t.identifier(spec.local.name)
              )
            );
          } else if (t.isImportNamespaceSpecifier(spec)) {
            // Mixed namespace + named is unusual; treat as separate const
            const decl = t.variableDeclaration("const", [
              t.variableDeclarator(
                t.identifier(spec.local.name),
                t.memberExpression(
                  t.identifier("__vfsRegistry__"),
                  t.stringLiteral(resolved),
                  true
                )
              ),
            ]);
            // Insert before current path and skip from properties
            path.insertBefore(decl);
          }
        }

        if (properties.length === 0) {
          path.remove();
          return;
        }

        const decl = t.variableDeclaration("const", [
          t.variableDeclarator(
            t.objectPattern(properties),
            t.memberExpression(
              t.identifier("__vfsRegistry__"),
              t.stringLiteral(resolved),
              true // computed
            )
          ),
        ]);

        path.replaceWith(decl);
      },
    },
  });
