import { ERR_SCH, ERR_VALID, ERR_WELLFORM, NO_ERR } from "../constants";
import { SaxesParser } from "saxes";
import { Diagnostic, Range, window, workspace } from "vscode";
import { Worker } from 'worker_threads';
import { join } from 'path';

import type { XMLDocumentManager } from "../core/XMLDocumentManager";
import type { ValidationResult, TagInfo, XIncludeLocation, NodePath } from "../types";
import type { DefaultNameResolver, Grammar } from "salve-annos";
import type { Base } from "salve-annos/lib/salve/name_patterns";
import type { SaxesAttributeNS, SaxesTag } from "saxes";
import { matchPath, parseXPath } from "../utils";

// Some code in this file is derived from:
// https://github.com/mangalam-research/salve/blob/0fd149e44bc422952d3b095bfa2cdd8bf76dd15c/lib/salve/parse.ts
// Mozilla Public License 2.0

export async function validateDocument(manager: XMLDocumentManager, signal: AbortSignal): Promise<ValidationResult | void> {
  if (signal.aborted) return;

  const grammar = await manager.getGrammar();
  const docUri = manager.uri;
  const xmlSource = await manager.documentText;
  const parser = manager.parser;
  const nameResolver = manager.nameResolver;

  if (parser && nameResolver) {
    if (grammar && docUri) {
      // If the grammar is set, the other values are too.
      return validateWithSchema(docUri.toString(), xmlSource, grammar, nameResolver, parser, signal)
    } else {
      try {
        parser.write(xmlSource).close();
        return;
      } catch(err: unknown) {
        const e = err as Error
        const range = new Range(parser.line-1, 0, parser.line-1, parser.column);
        const diagnostics = [new Diagnostic(range, e.message)];
        return {
          errorType: ERR_WELLFORM,
          errorCount: 1,
          diagnostics
        }
      }
    }
  }
}

function validateWithSchema(
  docUri: string, 
  xmlSource: string, 
  tree: Grammar, 
  nameResolver: DefaultNameResolver, 
  parser: SaxesParser, 
  signal: AbortSignal
): ValidationResult | void {

  if (signal.aborted) return;

  // Add an abort listener
  signal.addEventListener('abort', () => {
    parser.close(); // Stop the parser
    throw new Error('AbortError');
  });

  let error = NO_ERR;
  let errorCount = 0;
  const diagnostics: Diagnostic[] = [];
  const walker = tree.newWalker(nameResolver);
  const includeLocationStack: XIncludeLocation[] = [];
  // This variable tracks the total number of lines added by includes,
  // minus the lines taken up by the <xi:include> tags themselves.
  let lineAdjustment = 0;

  // TODO. fireEvent() can take any params in Salve, but we need more structure here.
  function fireEvent(name: string, args: any[]): void {
    const ret = walker.fireEvent(name, args);
    if (ret instanceof Array) {
      error = ERR_VALID;
      errorCount += ret.length;

      for (const err of ret) {
        let diagnosticUri = docUri;
        let lineNumber = parser.line - 1; // Convert to 0-based line
        let errorColumn = parser.column;
        let startColumn = 0;

        // When the error is expressed on endTag, it should still be reported on the startTag.
        if (name === "endTag") {
          const tagInfo: Partial<TagInfo> = {
            name: args[4],
            line: args[2],
            column: args[3]
          }
          lineNumber = (tagInfo.line || 1) - 1; // Convert to 0-based line
          errorColumn = (tagInfo.column || 0)
        }

        const currentInclude = includeLocationStack.length > 0 ? includeLocationStack[includeLocationStack.length - 1] : null;

        if (currentInclude) {
          // Error is inside an included file. Point to the include tag in the parent document.
          diagnosticUri = currentInclude.parentUri;
          lineNumber = currentInclude.line - 1; // Saxes line is 1-based.
          
          const document = workspace.textDocuments.find(doc => doc.uri.toString() === diagnosticUri);
          if (document) {
            const lineText = document.lineAt(lineNumber).text;
            // Try to find the whole <xi:include ... /> tag to highlight it.
            const tagMatch = lineText.match(/<xi:include\s+[^>]*>/);
            if (tagMatch && tagMatch.index !== undefined) {
                startColumn = tagMatch.index;
                errorColumn = startColumn + tagMatch[0].length;
            } else {
              // Fallback to the column from the parser if regex fails.
              startColumn = currentInclude.column > 0 ? currentInclude.column - 1 : 0;
              errorColumn = startColumn + 1;
            }
          }
        } else {
          // Error is in the main file. Adjust line number based on previous includes.
            lineNumber -= lineAdjustment;
          const document = workspace.textDocuments.find(doc => doc.uri.toString() === docUri.toString());
          if (document) {
            const lineText = document.lineAt(lineNumber).text;
            let errorCol0 = errorColumn - 1; // Convert to 0-based
            errorCol0 = Math.min(errorCol0, lineText.length - 1); // Ensure within bounds
    
            // Find the start of the tag by searching for "<" before the error column
            for (let i = errorCol0; i >= 0; i--) {
              if (lineText[i] === "<") {
                  startColumn = i;
                  break;
              }
            }
          }
        }
    
        // Create range from the start of the tag to the error column
        let range = new Range(lineNumber, startColumn, lineNumber, errorColumn);
    
        const names = err.getNames();
        const namesMsg = names.map((n: Base) => {
            const name = n.toJSON();
            let ns = name.ns ? `(${name.ns})` : "";
            return `"${name.name}" ${ns}`;
        }).join(" ");
    
        diagnostics.push(new Diagnostic(range, `${err.msg} — ${namesMsg}`));
      }
    }
  }

  const tagStack: TagInfo[] = [];
  let textBuf = "";

  function flushTextBuf(): void {
    if (textBuf !== "") {
      fireEvent("text", [textBuf]);
      textBuf = "";
    }
  }
  
  try {
    parser.on("processinginstruction", (pi) => {
      const getAttr = (name: string) => (pi.body.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
      if (pi.target === "xml-xi-map-enter") {
        includeLocationStack.push({
          uri: getAttr("uri"),
          line: parseInt(getAttr("parent-line"), 10),
          column: parseInt(getAttr("parent-col"), 10),
          parentUri: getAttr("parent-uri"),
        });
      } else if (pi.target === "xml-xi-map-leave") {
        const justLeft = includeLocationStack.pop();
        if (justLeft) {
          // The adjustment is the number of lines in the resolved document up to this point,
          // minus the original line number of the include tag. This gives the net lines added.
          lineAdjustment = (parser.line) - justLeft.line;
        }
      } else if (pi.target === "xml-xi-error") {
        let range = new Range(parser.line - 1, parseInt(getAttr("parent-start"), 10), parser.line - 1, parseInt(getAttr("parent-col"), 10));

        diagnostics.push(new Diagnostic(range, "Could not resolve XInclude"));
      }
    });

    parser.on("opentag", (node: SaxesTag) => {
      flushTextBuf();
      const names = Object.keys(node.attributes);
      const nsDefinitions = [];
      const attributeEvents = [];
      names.sort();
      for (const name of names) {
        const attr = node.attributes[name] as SaxesAttributeNS;
        if (name === "xmlns") { // xmlns="..."
          nsDefinitions.push(["", attr.value]);
        }
        else if (attr.prefix === "xmlns") { // xmlns:...=...
          nsDefinitions.push([attr.local, attr.value]);
        }
        else {
          attributeEvents.push(["attributeName", attr.uri, attr.local],
                                ["attributeValue", attr.value]);
        }
      }
      if (nsDefinitions.length !== 0) {
        nameResolver.enterContext();
        for (const definition of nsDefinitions) {
          nameResolver.definePrefix(definition[0], definition[1]);
        }
      }
      fireEvent("enterStartTag", [node.uri, node.local]);
      for (const event of attributeEvents) {
        fireEvent(event[0], event.slice(1));
      }
      fireEvent("leaveStartTag", []);
      tagStack.push({
        uri: node.uri || "",
        local: node.local || "",
        name: node.name,
        hasContext: nsDefinitions.length !== 0,
        line: parser.line,
        column: parser.column
      });
    });
  
    parser.on("text", (text: string) => {
      textBuf += text;
    });
  
    parser.on("closetag", () => {
      flushTextBuf();
      const tagInfo = tagStack.pop();
      if (tagInfo === undefined) {
        errorCount++;
        throw new Error("stack underflow");
      }
      fireEvent("endTag", [tagInfo.uri, tagInfo.local, tagInfo.line, tagInfo.column, tagInfo.name]);
      if (tagInfo.hasContext) {
        nameResolver.leaveContext();
      }
    });
  
    const entityRe = /^<!ENTITY\s+([^\s]+)\s+([""])(.*?)\2\s*>\s*/;
  
    parser.on("doctype", (doctype: string) => {
      // This is an extremely primitive way to handle ENTITY declarations in a
      // DOCTYPE. It is unlikely to support any kind of complicated construct.
      let cleaned = doctype
        .replace(/^.*?\[/, "")
        .replace(/].*?$/, "")
        .replace(/<!--(?:.|\n|\r)*?-->/g, "")
        .trim();
  
      while (cleaned.length !== 0) {
        const match = entityRe.exec(cleaned);
        if (match !== null) {
          const name = match[1];
          const value = match[3];
          cleaned = cleaned.slice(match[0].length);
          if (parser.ENTITIES[name] !== undefined) {
            throw new Error(`redefining entity: ${name}`);
          }
          parser.ENTITIES[name] = value;
        }
        else {
          errorCount++;
          throw new Error(`unexpected construct in DOCTYPE: ${doctype}`);
        }
      }
    });
  
    parser.on("end", () => {
      const result = walker.end();
      if (result !== false) {
        error = ERR_WELLFORM;
        errorCount += result.length;
        for (const err of result) {
          console.log(`on end`);
          console.log(err.toString());
        }
      }
    });
  
    parser.write(xmlSource).close();
  } catch(err) {
    // check if the validation has been aborted before reporting.
    if (signal.aborted) return;
  
    errorCount++;
    const e = err as Error
    error = ERR_WELLFORM;
    let lineNumber = parser.line - 1; // Convert to 0-based line
    let errorColumn = parser.column;
    let startColumn = 0;
    const currentInclude = includeLocationStack.length > 0 ? includeLocationStack[includeLocationStack.length - 1] : null;
    if (currentInclude) {
      // Error is inside an included file. Point to the include tag in the parent document.
      lineNumber = currentInclude.line - 1; // Saxes line is 1-based.
      
      const document = workspace.textDocuments.find(doc => doc.uri.toString() === docUri);
      if (document) {
        const lineText = document.lineAt(lineNumber).text;
        // Try to find the whole <xi:include ... /> tag to highlight it.
        const tagMatch = lineText.match(/<xi:include\s+[^>]*>/);
        if (tagMatch && tagMatch.index !== undefined) {
            startColumn = tagMatch.index;
            errorColumn = startColumn + tagMatch[0].length;
        } else {
            // Fallback to the column from the parser if regex fails.
            startColumn = currentInclude.column > 0 ? currentInclude.column - 1 : 0;
            errorColumn = startColumn + 1;
        }
      }
    } else {
      // Error is in the main file. Adjust line number based on previous includes.
      lineNumber -= lineAdjustment;
      const document = workspace.textDocuments.find(doc => doc.uri.toString() === docUri.toString());
      if (document) {
          const lineText = document.lineAt(lineNumber).text;
          let errorCol0 = errorColumn - 1; // Convert to 0-based
          errorCol0 = Math.min(errorCol0, lineText.length - 1); // Ensure within bounds
  
          // Find the start of the tag by searching for "<" before the error column
          for (let i = errorCol0; i >= 0; i--) {
              if (lineText[i] === "<") {
                  startColumn = i;
                  break;
              }
          }
      }
    }
    let range = new Range(lineNumber, startColumn, lineNumber, errorColumn);
    diagnostics.push(new Diagnostic(range, e.message));
  } 

  return {
    errorType: error,
    errorCount,
    diagnostics
  };
}

export async function validateWithSchematron(manager: XMLDocumentManager, signal: AbortSignal): Promise<ValidationResult | void> {
  if (signal.aborted) return;

  const sch = await manager.getSchematron();

  if (!sch) return;

  const xmlSource = await manager.documentText;

  return new Promise((resolve) => {
    const worker = new Worker(
      join(__dirname, './schematronWorker.js'),
      {
        workerData: {
          xmlSource,
          schematronSource: sch.rawText,
          embedded: sch.embedded
        }
      }
    );

    // Handle abortion
    signal.addEventListener('abort', () => {
      worker.terminate();
      resolve(void 0);
    });

    worker.on('message', async (result) => {
      if (result.error) {
        // only report to user if error is not because of xml parsing (well-formedness)
        if (result.errorName !== "XError") {
          console.error('Schematron validation failed:', result.error);
          window.showInformationMessage("Schematron validation failed.");
        }
        resolve(void 0);
        return;
      }

      const errors = result.errors;
      const diagnostics: Diagnostic[] = [];
      const errorCount = errors ? errors.length : 0;

      if (errors) {
        for (const err of errors) {
          const errLoc = await locateSchErrInXML(xmlSource, err.location);
          if (errLoc) {
            const [startLine, startColumn, endLine, endColumn] = errLoc;
            const errorRange = new Range(startLine, startColumn, endLine, endColumn);
            diagnostics.push(new Diagnostic(errorRange, err.text));
          }
        }
      }

      resolve({
        errorType: ERR_SCH,
        errorCount,
        diagnostics
      });
    });

    worker.on('error', (error) => {
      console.error('Worker error:', error);
      window.showInformationMessage("Schematron validation failed.");
      resolve(void 0);
    });
  });
}

async function locateSchErrInXML(xml: string, xpath: string): Promise<[number, number, number, number] | null> {
  // gives the xpath expression, finds the line number using saxes parser
  const steps = parseXPath(xpath);
  const parser = new SaxesParser({ xmlns: true, position: true });

  const pathStack: NodePath[] = [];
  const siblingCountStack: Record<string, number>[] = [];

  let currentTagName: string | null = null;
  let tagStartPos: { line: number; column: number } | null = null;
  const attributePositions: {
    [key: string]: { line: number; startCol: number; endCol: number };
  } = {};

  return new Promise((resolve, reject) => {
    let found = false;

    parser.on("opentagstart", (tag) => {
      currentTagName = null;
      // parser.column includes "<" + tag.name.length, so we subtract both.
      tagStartPos = { line: parser.line - 1, column: parser.column - tag.name.length - 1};
      siblingCountStack.push({});
    });

    parser.on("attribute", (attr) => {
      if (!attr.prefix && attr.local === "xmlns") return;
      const name =
        attr.prefix !== undefined && attr.prefix !== "" ? `${attr.prefix}:${attr.local}` : attr.local;
      const nameLength = name.length;
      // parser.column includes the equal, the _first_ quote and the attribute value.
      const startCol = parser.column - nameLength - attr.value.length - 3;
      const endCol = parser.column;

      const key = `{${attr.uri || ""}}${attr.local}`;
      attributePositions[key] = {
        line: parser.line - 1,
        startCol,
        endCol,
      };
    });

    parser.on("opentag", (tag: SaxesTag) => {
      if (found) return;

      const ns = tag.uri ?? "";
      const local = tag.local;
      currentTagName = tag.name;

      const parentSiblings = siblingCountStack[siblingCountStack.length - 2];
      const key = `${ns || ""}|${local}`;
      if (parentSiblings) {
        parentSiblings[key] = (parentSiblings[key] ?? 0) + 1;
      }

      const index = parentSiblings?.[key] ?? 1;
      pathStack.push({ ns, local: local || "", index });

      const lastStep = steps[steps.length - 1];

      if (
        pathStack.length === steps.length &&
        !lastStep.isAttribute &&
        matchPath(pathStack, steps)
      ) {
        found = true;
        if (tagStartPos && currentTagName) {
          const startLine = tagStartPos.line;
          const startCol = tagStartPos.column;
          const endLine = tagStartPos.line;
          const endCol = tagStartPos.column + currentTagName.length;
          resolve([startLine, startCol, endLine, endCol]);
        } else {
          resolve(null); // fallback
        }
      }

      // Handle attribute path
      if (
        lastStep?.isAttribute &&
        pathStack.length === steps.length - 1 &&
        matchPath(pathStack, steps.slice(0, -1))
      ) {
        const attrKey = `{${lastStep.name.namespace}}${lastStep.name.local}`;
        const pos = attributePositions[attrKey];
        if (pos) {
          found = true;
          resolve([pos.line, pos.startCol, pos.line, pos.endCol]);
        }
      }
    });

    parser.on("closetag", () => {
      pathStack.pop();
      siblingCountStack.pop();
    });

    parser.on("error", reject);

    parser.on("end", () => {
      if (!found) resolve(null);
    });

    parser.write(xml).close();
  });
}
