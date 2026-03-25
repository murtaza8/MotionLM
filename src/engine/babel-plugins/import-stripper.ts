import type { NodePath, PluginObj } from "@babel/core";
import type {
  ImportDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
} from "@babel/types";

/**
 * Babel visitor plugin that strips module boundary syntax so the transformed
 * code can run inside a `new Function()` constructor without import/export
 * errors.
 *
 * - `ImportDeclaration` — removed entirely (Remotion APIs are injected via
 *   the Function constructor scope)
 * - `ExportNamedDeclaration` — the export wrapper is removed; the inner
 *   declaration (const, function, class) is kept in place
 * - `ExportDefaultDeclaration` — removed entirely (default exports are not
 *   used in this project; the root component is identified by name convention)
 */
export const importStripperPlugin = (): PluginObj => ({
  visitor: {
    ImportDeclaration(path: NodePath<ImportDeclaration>) {
      path.remove();
    },

    ExportNamedDeclaration(path: NodePath<ExportNamedDeclaration>) {
      if (path.node.declaration) {
        // Keep the inner declaration, drop the export wrapper
        path.replaceWith(path.node.declaration);
      } else {
        // export { foo, bar } with no declaration — remove the whole node
        path.remove();
      }
    },

    ExportDefaultDeclaration(path: NodePath<ExportDefaultDeclaration>) {
      path.remove();
    },
  },
});
