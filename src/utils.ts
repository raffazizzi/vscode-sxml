import { Uri, window } from "vscode";
import { NodePath, XPathStep } from "./types";

export function normalizeSchemaUrl(schemaURL: string, baseUri?: string): string {
  try {
    const parsed = new URL(schemaURL);
    if (parsed.protocol.length > 2 && schemaURL.includes("://")) {
      return schemaURL;
    }
  } catch {
    // Not a full URL with protocol
  }

  // Absolute local file path (UNIX or Windows)
  if (schemaURL.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(schemaURL)) {
    return Uri.file(schemaURL).toString();
  }

  // Treat as relative path
  if (baseUri) {
    try {
      const base = Uri.parse(baseUri);
      return Uri.joinPath(base, "..", schemaURL).toString();
    } catch {
      // fallback
    }
  }

  if (window.activeTextEditor?.document.uri) {
    return Uri.joinPath(window.activeTextEditor.document.uri, "..", schemaURL).toString();
  }

  return schemaURL;
}

export function truncate(str: string, n: number){
  return (str.length > n) ? str.substring(0, n-1) + "…" : str;
}

export function parseXPath(xpath: string): XPathStep[] {
  const steps: XPathStep[] = [];
  // "/" on its own is the document node, e.g. from a Schematron rule with context="/". It has no steps.
  if (xpath === "/") return steps;
  let pos = 0;
  while (pos < xpath.length) {
    if (xpath[pos] !== '/') {
      throw new Error(`Expected '/' at position ${pos}: ${xpath.slice(pos, pos + 20)}`);
    }
    pos++; // skip '/'
    // Check for @
    const isAttribute = xpath[pos] === '@';
    if (isAttribute) pos++;
    if (xpath.slice(pos, pos + 2) !== 'Q{') {
      throw new Error(`Expected 'Q{' at position ${pos}: ${xpath.slice(pos, pos + 20)}`);
    }
    pos += 2;
    const nsEnd = xpath.indexOf('}', pos);
    if (nsEnd === -1) {
      throw new Error(`Unterminated namespace at position ${pos}`);
    }
    const namespace = xpath.slice(pos, nsEnd);
    pos = nsEnd + 1;
    // Read local name
    const nameMatch = xpath.slice(pos).match(/^([^\[/@]+)/);
    if (!nameMatch) {
      throw new Error(`Missing local name at position ${pos}`);
    }
    const local = nameMatch[1];
    pos += local.length;
    // Optional index (for elements)
    let index: number | undefined = undefined;
    if (xpath[pos] === '[') {
      const idxEnd = xpath.indexOf(']', pos);
      if (idxEnd === -1) {
        throw new Error(`Unterminated index at position ${pos}`);
      }
      index = parseInt(xpath.slice(pos + 1, idxEnd), 10);
      pos = idxEnd + 1;
    }
    steps.push({
      name: { namespace, local },
      isAttribute,
      index: isAttribute ? undefined : index ?? 1,
    });
  }
  return steps;
}

export function matchPath(path: NodePath[], steps: XPathStep[]): boolean {
  if (path.length !== steps.length) return false;
  return path.every((p, i) => {
    const s = steps[i];
    return (
      p.ns === s.name.namespace &&
      p.local === s.name.local &&
      (!s.index || p.index === s.index)
    );
  });
}

export function makeStatusMsg(msg: string, icon: string, sch = false, tail?: string) {
  const _tail = tail ? ` ${tail}` : "";
  const fullMsg = `${msg}${_tail}`;
  return sch
    ? `$(gear~spin) ${fullMsg}; checking Schematron.`
    : `$(${icon}) ${fullMsg}.`
}

/**
 * Scans the full XML document text and returns every xml:id value found.
 * Supports both double-quoted and single-quoted attribute values.
 * Used to provide IDREF completion suggestions (TEI convention: resp="#someId").
 */
export function collectXmlIds(documentText: string): string[] {
  const ids: string[] = [];
  const idPattern = /xml:id\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(documentText)) !== null) {
    const id = match[1] ?? match[2];
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}