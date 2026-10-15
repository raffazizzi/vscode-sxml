import { nameStart, nameChars } from "../constants";
import { markupEnd } from "./autorename";

const tagNamePattern = new RegExp(`[${nameStart}][${nameChars}]*`, "uy");

// True if [a, b] contains [s, e] and is strictly larger.
const contains = (a: number, b: number, s: number, e: number) =>
  a <= s && e <= b && (a < s || e < b);

// Returns [start, end] offsets of the smallest element strictly containing the selection.
export function findParentElement(
  text: string,
  selStart: number,
  selEnd: number,
): [number, number] | undefined {
  const stack: { name: string; start: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) return;

    const delimiter = text.startsWith("<!--", start) ? "-->"
      : text.startsWith("<![CDATA[", start) ? "]]>"
      : text.startsWith("<?", start) ? "?>" : undefined;
    if (delimiter) {
      const end = text.indexOf(delimiter, start + 2);
      if (end < 0) return;
      cursor = end + delimiter.length;
      continue;
    }
    if (text.startsWith("<!", start)) {
      const end = markupEnd(text, start + 2, true);
      if (end < 0) return;
      cursor = end + 1;
      continue;
    }

    const closing = text[start + 1] === "/";
    const nameOffset = start + (closing ? 2 : 1);
    tagNamePattern.lastIndex = nameOffset;
    const match = tagNamePattern.exec(text);
    if (!match) return;
    const end = markupEnd(text, nameOffset + match[0].length);
    if (end < 0) return;
    cursor = end + 1;

    if (closing) {
      const opening = stack.pop();
      if (!opening || opening.name !== match[0]) return;
      if (contains(opening.start, end + 1, selStart, selEnd)) {
        return [opening.start, end + 1];
      }
    } else if (text[end - 1] === "/") {
      if (contains(start, end + 1, selStart, selEnd)) return [start, end + 1];
    } else {
      stack.push({ name: match[0], start });
    }
  }
  return;
}

// Returns the name of the element whose content contains offset, or undefined.
export function findSplitElement(
  text: string,
  offset: number,
): string | undefined {
  const range = findParentElement(text, offset, offset);
  if (!range) return;
  const [start, end] = range;
  const openEnd = markupEnd(text, start + 1);
  if (openEnd < 0 || text[openEnd - 1] === "/") return;
  const closeStart = text.lastIndexOf("</", end - 1);
  if (offset < openEnd + 1 || offset > closeStart) return;
  return /^[^\s/>]+/.exec(text.slice(start + 1))?.[0];
}