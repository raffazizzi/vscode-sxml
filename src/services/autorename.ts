import { LinkedEditingRanges, Range } from "vscode";
import type {
  CancellationToken,
  LinkedEditingRangeProvider,
  Position,
  TextDocument,
} from "vscode";

import { nameStart, nameChars } from "../constants";

type TagName = { name: string; start: number; end: number };
export type TagPair = [TagName, TagName];

// XML NameStartChar and NameChar ranges.
const tagNamePattern = new RegExp(`[${nameStart}][${nameChars}]*`, "uy");
const wordPattern = new RegExp(`[${nameChars}]+`, "u");

// A '>' in an attribute value or DOCTYPE subset doesn't end the tag.
export function markupEnd(
  text: string,
  start: number,
  declaration = false,
): number {
  let quote = "";
  let brackets = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (declaration && text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) return -1;
      i = end + 2;
    } else if (declaration && text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) return -1;
      i = end + 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (declaration && char === "[") {
      brackets++;
    } else if (declaration && char === "]") {
      brackets--;
    } else if (char === ">" && brackets === 0) {
      return i;
    } else if (!declaration && char === "<") {
      return -1;
    }
  }
  return -1;
}

// Use editor offsets; expanding XIncludes would shift the tag positions.
export function findTagPair(text: string, offset: number): TagPair | undefined {
  const stack: TagName[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) return;

    // Skip comments, CDATA, and processing instructions.
    const delimiter = text.startsWith("<!--", start)
      ? "-->"
      : text.startsWith("<![CDATA[", start)
        ? "]]>"
        : text.startsWith("<?", start)
          ? "?>"
          : undefined;
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
    const nameEnd = nameOffset + match[0].length;
    if (!/[\t\r\n />]/.test(text[nameEnd] ?? "")) return;
    const end = markupEnd(text, nameEnd);
    if (end < 0) return;
    cursor = end + 1;
    const tag = { name: match[0], start: nameOffset, end: nameEnd };

    if (closing) {
      if (!/^[\t\r\n ]*$/.test(text.slice(nameEnd, end))) return;
      const opening = stack.pop();
      // A mismatch means we can no longer trust the nesting.
      if (!opening || opening.name !== tag.name) return;
      if (
        [opening, tag].some(
          (range) => offset >= range.start && offset <= range.end,
        )
      ) {
        return [opening, tag];
      }
    } else if (text[end - 1] !== "/") {
      stack.push(tag);
    }
  }
  return;
}

export default class AutoRenameProvider implements LinkedEditingRangeProvider {
  provideLinkedEditingRanges(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ) {
    if (token.isCancellationRequested) return;
    const pair = findTagPair(document.getText(), document.offsetAt(position));
    if (!pair) return;
    const ranges = pair.map(
      (tag) =>
        new Range(document.positionAt(tag.start), document.positionAt(tag.end)),
    );
    return new LinkedEditingRanges(ranges, wordPattern);
  }
}
