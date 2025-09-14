import { XINCLUDE_LOCAL, XINCLUDE_NS } from "../constants";
import { normalizeSchemaUrl } from "../utils";
import { SaxesParser } from "saxes";
import { Uri, window, workspace } from "vscode";

import type { SaxesAttributeNS, SaxesTag } from "saxes";

export async function resolveXIncludes(xmlSource: string, depth = 0): Promise<string> {
  const resolverParser = new SaxesParser({ xmlns: true, position: true });
  const outputParts: (string | Promise<string>)[] = [];
  
  let lastPos = 0;
  let foundXi = false;

  resolverParser.on("opentag", (node: SaxesTag) => {
    if (node.uri === XINCLUDE_NS && node.local === XINCLUDE_LOCAL) {
      foundXi = true;
      const depthLimit = workspace.getConfiguration("sxml").get("xincludeDepth") as number || 50;
      if (depth < depthLimit) {
        // Find the start of the tag by searching backwards from the parser’s current position.
        // The parser’s position is at the character after the ">" of the opening tag.
        const tagStartPosition = xmlSource.lastIndexOf("<", resolverParser.position - 1);
        
        if (tagStartPosition === -1) {
          // This should not happen in well-formed XML. We"ll log an error and continue.
          console.error("Could not find start of xi:include tag.");
          return;
        }

        // Push the XML content that came before this xi:include tag.
        outputParts.push(xmlSource.substring(lastPos, tagStartPosition));

        // If the tag is self-closing, we update lastPos now. Otherwise, the "closetag"
        // handler will update it to the position after the closing tag.
        if (node.isSelfClosing) {
          lastPos = resolverParser.position;
        }

        // if the xinclude should just return a warning, we do that instead of resolving it.
        // TODO: this will return the setting value at the first time it is called and
        // will not show changes to the config without restarting VSCode. There is an config change event, but how to trickle down to here?
        if (workspace.getConfiguration("sxml").get("xincludeSupport") === false) {
          const line = resolverParser.line;
          const col = resolverParser.column;
          const warningPI = `<?xml-xi-map-enter warning="XInclude resolution is turned off in settings." parent-line="${line}" parent-col="${col}"?><?xml-xi-map-leave?>`;
          outputParts.push(warningPI);
          return;
        }

        const hrefAttr = node.attributes.href as SaxesAttributeNS | undefined;
        if (hrefAttr) {
          const href = hrefAttr.value;
          const hrefURL = normalizeSchemaUrl(href);
          const line = resolverParser.line;
          const col = resolverParser.column;
          const makePI = (resolvedNestedXml: string) => {
            // Wrap the resolved content in our source map PIs

            // But only if it’s in the top-level document.
            if (depth > 0) {
              const piNestedEnter = `<?xml-xi-nested-enter uri="${hrefURL}"?>`;
              const piNestedLeave = `<?xml-xi-nested-leave?>`;
              return `${piNestedEnter}${resolvedNestedXml}${piNestedLeave}`;
            };

            const piEnter = `<?xml-xi-map-enter uri="${hrefURL}" parent-line="${line}" parent-col="${col}"?>`;
            const piLeave = `<?xml-xi-map-leave?>`;
            return `${piEnter}${resolvedNestedXml}${piLeave}`;
          }
          const handleErr = (err: Error) => {
            return `<?xml-xi-error err="${err}" parent-start="${resolverParser.position}" parent-col="${col}"?>`;
          }
          let includedContentPromise: Promise<string>;
          if (hrefURL.startsWith("http")) {
            // If the href is a URL, we fetch the content.
            includedContentPromise = fetch(hrefURL)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`Failed to fetch ${hrefURL}: ${response.statusText}`);
                }
                return response.text();
              })
              .then(async (doc) => {
                const text = doc.replace(/^\s*<\?xml.*?\?>\s*/, "");                
                return await resolveXIncludes(text, depth + 1);
              })
              .then(makePI).catch(handleErr)
          } else {
            includedContentPromise = (workspace.openTextDocument(Uri.parse(hrefURL))
              .then(async (doc) => {
                const text = doc.getText().replace(/^\s*<\?xml.*?\?>\s*/, "");
                return await resolveXIncludes(text, depth + 1);
              })
              .then(makePI) as Promise<string>).catch(handleErr);
          }
          outputParts.push(includedContentPromise);
        }

        
      } else {
        // Too deep, just skip the include and continue.
        window.showInformationMessage("Maximum XInclude depth reached, skipping further includes.");
      }
    }
  });

  resolverParser.on("closetag", (node: SaxesTag) => {
    if (node.uri === XINCLUDE_NS && node.local === XINCLUDE_LOCAL) {
      if (depth === 0) {
        // This handles the case for a non-self-closing <xi:include>...</xi:include>
        lastPos = resolverParser.position;
      }
    }
  });

  try {
    // Run the parser over the source XML.
    resolverParser.write(xmlSource).close();
  } catch (err) {
    // if it is deeper, stop including.
    // if the document with xi:includes is not well-formed, we cannot resolve includes.
    if (depth > 0 || !foundXi) {
      return xmlSource;
    }
  }

  // Append any remaining text after the last xi:include.
  outputParts.push(xmlSource.substring(lastPos));

  // Wait for all file I/O and recursive calls to complete, then join the parts.
  const resolvedParts = await Promise.all(outputParts);
  return resolvedParts.join("");
}