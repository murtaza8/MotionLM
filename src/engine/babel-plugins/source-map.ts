import type { NodePath, PluginObj } from "@babel/core";
import type { JSXOpeningElement } from "@babel/types";
import * as t from "@babel/types";

/**
 * Returns the tag name of a JSX opening element — e.g. "AbsoluteFill", "h1",
 * "Foo.Bar". Matches the id format used by the temporal parser: `${name}:${line}`.
 */
const getJsxTagName = (nameNode: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string => {
  if (t.isJSXIdentifier(nameNode)) return nameNode.name;
  if (t.isJSXMemberExpression(nameNode)) {
    const obj = t.isJSXIdentifier(nameNode.object) ? nameNode.object.name : "?";
    return `${obj}.${nameNode.property.name}`;
  }
  return "Unknown";
};

/**
 * Babel visitor plugin that injects data-motionlm-* attributes onto every JSX
 * opening element at compile time, enabling the inspector overlay to map DOM
 * nodes back to their source locations.
 *
 * Injected attributes (prepended before existing attributes so user spreads
 * can override):
 *   data-motionlm-id="{elementName}:{lineNumber}"
 *   data-motionlm-line="{lineNumber}"
 *   data-motionlm-component="{elementName}"
 *
 * The id format matches the temporal parser's node key: `${name}:${line}`.
 *
 * JSX fragments (<>...</>) are not JSXOpeningElement nodes with a name and
 * cannot receive attributes — the visitor naturally skips them.
 */
export const sourceMapPlugin = (): PluginObj => ({
  visitor: {
    JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
      const line = path.node.loc?.start.line ?? 0;
      const elementName = getJsxTagName(path.node.name);

      const idAttr = t.jsxAttribute(
        t.jsxIdentifier("data-motionlm-id"),
        t.stringLiteral(`${elementName}:${line}`)
      );

      const lineAttr = t.jsxAttribute(
        t.jsxIdentifier("data-motionlm-line"),
        t.stringLiteral(String(line))
      );

      const componentAttr = t.jsxAttribute(
        t.jsxIdentifier("data-motionlm-component"),
        t.stringLiteral(elementName)
      );

      // Insert at position 0 so existing attributes (and spreads) follow,
      // allowing user-defined attributes to override when needed.
      path.node.attributes.unshift(idAttr, lineAttr, componentAttr);
    },
  },
});
