/**
 * Test-only: walks the element tree a Server Component returns, without
 * rendering it, so a page test can assert which props the page handed to a
 * component (the preview page's test has its own copy of this, written first).
 */
import { isValidElement, type ReactNode } from 'react';

/** Depth-first search of a React element tree for the first element of `type`. */
export function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node as unknown as { props: Record<string, unknown> };
  return findElement(node.props.children, type);
}
