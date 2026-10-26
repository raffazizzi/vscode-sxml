import { nameStart, nameChars } from "../constants";
import { markupEnd } from "./autorename";

const referencePattern = new RegExp(
  `(?:#[0-9]+|#x[0-9a-fA-F]+|[:${nameStart}][:${nameChars}]*);`, "uy"
);

export function findMalformedEntity(text: string): { start: number; end: number } | undefined {
  let inTag = false;
  let quote = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (!inTag && char === "<") {
      const delimiter = text.startsWith("<!--", i) ? "-->"
        : text.startsWith("<![CDATA[", i) ? "]]>"
        : text.startsWith("<?", i) ? "?>" : undefined;
      if (delimiter) {
        const end = text.indexOf(delimiter, i + 2);
        if (end < 0) return;
        i = end + delimiter.length - 1;
        continue;
      }
      if (text.startsWith("<!", i)) {
        const end = markupEnd(text, i + 2, true);
        if (end < 0) return;
        i = end;
        continue;
      }
      inTag = true;
      continue;
    }

    if (inTag) {
      if (quote) {
        if (char === quote) {
          quote = "";
          continue;
        }
      } else {
        if (char === '"' || char === "'") quote = char;
        else if (char === ">") inTag = false;
        continue;
      }
    }

    if (char !== "&") continue;
    referencePattern.lastIndex = i + 1;
    const match = referencePattern.exec(text);
    if (match) {
      i += match[0].length;
      continue;
    }

    // Stop at markup or whitespace instead of consuming a later semicolon.
    let end = i + 1;
    while (end < text.length && !/[\s<>&"';]/.test(text[end])) end++;
    if (text[end] === ";") end++;
    return { start: i, end };
  }
  return;
}
