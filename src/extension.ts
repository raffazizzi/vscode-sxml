import * as vscode from 'vscode';
import SalveCompletionProvider from './completion';
import 'cross-fetch/polyfill';
import * as url from 'url';
import * as path from 'path';
import { Grammar, convertRNGToPattern, DefaultNameResolver } from 'salve-annos';
import { SaxesParser, SaxesTag, SaxesAttributeNS } from 'saxes';
import { Base } from 'salve-annos/lib/salve/name_patterns';
import Schematron from 'node-xsl-schematron';

const ERR_VALID = 'ERR_VALID';
const ERR_WELLFORM = 'ERR_WELLFORM';
const ERR_SCHEMA = 'ERR_SCHEMA';
const NO_ERR = 'NO_ERR';
const EMBEDDED_SCH = 'EMBEDDED_SCH';
const XINCLUDE_NS = 'http://www.w3.org/2001/XInclude';
const XINCLUDE_LOCAL = 'include';


// XML Name regex (minus : and [#x10000-#xEFFFF] range)
const nameStartChar = new RegExp(/_|[A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
const nameChar = new RegExp(`${nameStartChar.source}|-|\\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]`);
const XMLname = new RegExp(`^(${nameStartChar.source})(${nameChar.source})*$`);

let validationTimer: NodeJS.Timeout;

export interface StoredGrammar {
  rngURI?: string;
  grammar?: Grammar | void;
}

export interface GrammarStore {
  [key: string]: StoredGrammar;
}

let diagnosticCollection: vscode.DiagnosticCollection;
const grammarStore: GrammarStore = {};
const sch = new Schematron();
let validations: {
  parsePromise: Promise<void>,
  controller: AbortController
}[] = [];


type TagInfo = {
  uri: string;
  local: string;
  hasContext: boolean;
};

export function normalizeSchemaUrl(schemaURL: string): string {
  try {
    new URL(schemaURL);
    return schemaURL;
  } catch (error) {
    const schemaPath = path.parse(schemaURL);
    const activeEditor = vscode.window.activeTextEditor;
    // Determine if local path.
    if (schemaPath.root !== "") {
      return url.pathToFileURL(schemaURL).toString();
    } else {
      // NOT a full URL, treat as relative path
      const basePath = activeEditor?.document.uri.path.split('/').slice(0, -1).join('/');
      return url.pathToFileURL(basePath + '/' + schemaURL).toString();
    }
  }
}

async function locateSchema(): Promise<void | { schema?: string; schematron?: string; fileText: string; xmlURI: vscode.Uri; }> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }
  
  const fileText = activeEditor.document.getText();
  const xmlURI = activeEditor.document.uri;

  let extKey = activeEditor.document.fileName.split('.').pop() as keyof typeof defaultSchemas;

  const defaultSchemas = vscode.workspace.getConfiguration("sxml").get("defaultSchemas") as {[key:string]:string};

  // Set schemaURL to value from settings if possible
  let schemaURL;
  let schematronURL;
  if (defaultSchemas.hasOwnProperty(extKey)){
    console.log("File extension", extKey,"is in settings, with RNG URL: ", defaultSchemas[extKey]);
    schemaURL = defaultSchemas[extKey];
  }

  // Locate RNG from active file
  let schemaURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0"/s);
  // Retry with schematypens first
  schemaURLMatch = schemaURLMatch ? schemaURLMatch : fileText.match(/<\?xml-model.+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0".+?href="([^"]+)"/s);

  // Locate Schematron from active file
  let schematronURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".+?schematypens="http:\/\/purl.oclc.org\/dsdl\/schematron"/s);
  // Retry with schematypens first
  schematronURLMatch = schematronURLMatch ? schematronURLMatch : fileText.match(/<\?xml-model.+?schematypens="http:\/\/purl.oclc.org\/dsdl\/schematron".+?href="([^"]+)"/s);

  // If RNG set inside document, use that.  Otherwise use rng provided by settings.  If neither exist, simply return.
  if (schemaURLMatch) {
    // Get schema URL from document if possible, overriding settings if needed
    schemaURL = schemaURLMatch[1];
    console.log("Now schemaURL is: ", schemaURL)
  }
  if (schematronURLMatch) {
    schematronURL = schematronURLMatch[1];
    console.log("Now schematronURL is: ", schematronURL)
  }

  if (!schemaURL && !schematronURL) {
    console.log("No schema URL specified in either settings or the file")
    return;
  }

  const schema = schemaURL && normalizeSchemaUrl(schemaURL);
  let schematron = schematronURL && normalizeSchemaUrl(schematronURL);
  
  if (schematron && schematron === schema) {
    schematron = EMBEDDED_SCH;
    console.log("Schematron is the same as RNG schema, using embedded schematron");
  } else if (schematron) {
    // retrieve and set schematron
    try {
      let schematronData: string;
      if (schematron.startsWith('http')) {
        // If the href is a URL, we fetch the content.
        const response = await fetch(schematron);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${schematron}: ${response.statusText}`);
        }
        schematronData = await response.text();
      } else {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(schematron));
        schematronData = doc.getText();          
      }
      sch.setSchematron(schematronData);
    } catch (err) {
      console.log(err)
      vscode.window.showInformationMessage('Could not fetch schematron from URL.');
    }
  }

  return {schema, schematron, fileText, xmlURI};
}

export async function grammarFromSource(rngSource: string, embeddedSch = false): Promise<Grammar | void> {
	// Treat it as a Relax NG schema.
  const schemaURL = new URL(rngSource);
  try {
    const s = await convertRNGToPattern(schemaURL);
    if (embeddedSch) {
      await sch.setRNG(s.schemaText);
    }
    return s.pattern;
  } catch(err) {
    console.log(err);
    vscode.window.showInformationMessage('Could not parse schema.');
  }
}

async function parseWithoutSchema(xmlSource: string, xmlURI: string): Promise<String> {
  diagnosticCollection.clear();
  let error = NO_ERR;
  let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();
  const parser = new SaxesParser({ xmlns: true, position: true });
  try {
    parser.write(xmlSource).close();
  } catch(err: unknown) {
    const e = err as Error
    error = ERR_WELLFORM;
    let range = new vscode.Range(parser.line-1, 0, parser.line-1, parser.column);
    let diagnostics = diagnosticMap.get(xmlURI);
    if (!diagnostics) { diagnostics = []; }
    diagnostics.push(new vscode.Diagnostic(range, e.message));
    diagnosticMap.set(xmlURI, diagnostics);
  }

  // Show diagnostics.
  diagnosticMap.forEach((diags, file) => {
    diagnosticCollection.set(vscode.Uri.parse(file), diags);
  });

  return error;
}

async function resolveXIncludes(xmlSource: string): Promise<string> {
  const resolverParser = new SaxesParser({ xmlns: true, position: true });
  const outputParts: (string | Promise<string>)[] = [];
  let lastPos = 0;
  let includeDepth = 0;

  resolverParser.on('opentag', (node: SaxesTag) => {
    if (node.uri === XINCLUDE_NS && node.local === XINCLUDE_LOCAL) {
      if (includeDepth === 0) {
        // Find the start of the tag by searching backwards from the parser's current position.
        // The parser's position is at the character after the '>' of the opening tag.
        const tagStartPosition = xmlSource.lastIndexOf('<', resolverParser.position - 1);
        
        if (tagStartPosition === -1) {
          // This should not happen in well-formed XML. We'll log an error and continue.
          console.error("Could not find start of xi:include tag.");
          return;
        }

        // Push the XML content that came before this xi:include tag.
        outputParts.push(xmlSource.substring(lastPos, tagStartPosition));


        const hrefAttr = node.attributes.href as SaxesAttributeNS | undefined;
        if (hrefAttr) {
          const href = hrefAttr.value;
          const hrefURL = normalizeSchemaUrl(href);
          const line = resolverParser.line;
          const col = resolverParser.column;
          const makePI = (resolvedNestedXml: string) => {
            // Wrap the resolved content in our source map PIs
            const piEnter = `<?xml-xi-map-enter uri="${hrefURL}" parent-line="${line}" parent-col="${col}"?>`;
            const piLeave = `<?xml-xi-map-leave?>`;
            return `${piEnter}${resolvedNestedXml}${piLeave}`;
          }
          const handleErr = (err: Error) => {
            return `<?xml-xi-error err="${err}" parent-start="${resolverParser.position}" parent-col="${col}"?>`;
          }
          let includedContentPromise: Promise<string>;
          if (hrefURL.startsWith('http')) {
            // If the href is a URL, we fetch the content.
            includedContentPromise = fetch(hrefURL)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`Failed to fetch ${hrefURL}: ${response.statusText}`);
                }
                return response.text();
              })
              .then(doc => {
                const text = doc.replace(/^\s*<\?xml.*?\?>\s*/, '');
                return resolveXIncludes(text);
              })
              .then(makePI).catch(handleErr)
          } else {
            includedContentPromise = (vscode.workspace.openTextDocument(vscode.Uri.parse(hrefURL))
              .then(doc => {
                const text = doc.getText().replace(/^\s*<\?xml.*?\?>\s*/, '');
                return resolveXIncludes(text);
              })
              .then(makePI) as Promise<string>).catch(handleErr);
          }
          outputParts.push(includedContentPromise);
        }

        // If the tag is self-closing, we update lastPos now. Otherwise, the 'closetag'
        // handler will update it to the position after the closing tag.
        if (node.isSelfClosing) {
          lastPos = resolverParser.position;
        }
      }
      includeDepth++;
    }
  });

  resolverParser.on('closetag', (node: SaxesTag) => {
    if (node.uri === XINCLUDE_NS && node.local === XINCLUDE_LOCAL) {
      includeDepth--;
      if (includeDepth === 0) {
        // This handles the case for a non-self-closing <xi:include>...</xi:include>
        lastPos = resolverParser.position;
      }
    }
  });

  // Run the parser over the source XML.
  resolverParser.write(xmlSource).close();

  // Append any remaining text after the last xi:include.
  outputParts.push(xmlSource.substring(lastPos));

  // Wait for all file I/O and recursive calls to complete, then join the parts.
  const resolvedParts = await Promise.all(outputParts);
  return resolvedParts.join('');
}

async function parse(isNewSchema: boolean, rngSource: string, xmlSource: string, xmlURI: string, embeddedSch: boolean = false): Promise<{errorType: string, errorCount: number, diagnostics: vscode.Diagnostic[]}> {
  // Parsing function adapted from 
  // https://github.com/mangalam-research/salve/blob/0fd149e44bc422952d3b095bfa2cdd8bf76dd15c/lib/salve/parse.ts
  // Mozilla Public License 2.0

  const resolvedXmlSource = await resolveXIncludes(xmlSource);
  const parser = new SaxesParser({ xmlns: true, position: true });
  let tree: void | Grammar | null = null;
  let errorCount = 0;

  // Only get grammar from source if necessary.
  if (!isNewSchema) {
    tree = grammarStore[xmlURI].grammar;
  }
  if (!tree) {
    tree = await grammarFromSource(rngSource, embeddedSch);
  }
  if (tree) {
    grammarStore[xmlURI].grammar = tree;
  } else {
    errorCount++;
    return {
      errorType: ERR_SCHEMA,  
      errorCount: errorCount, 
      diagnostics: []
    };
  }

	const nameResolver = new DefaultNameResolver();
  const walker = tree.newWalker(nameResolver);
	
  let error = NO_ERR;
  
  // Set up VS code error report
  diagnosticCollection.clear();
  let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

  // --- Source Mapping Logic ---
  interface IncludeLocation {
    uri: string;
    line: number;
    column: number;
    parentUri: string;
  }
  const includeLocationStack: IncludeLocation[] = [];
  // This variable tracks the total number of lines added by includes,
  // minus the lines taken up by the <xi:include> tags themselves.
  let lineAdjustment = 0;

  function fireEvent(name: string, args: any[]): void {
		const ret = walker.fireEvent(name, args);
    if (ret instanceof Array) {
      error = ERR_VALID;
      errorCount += ret.length;

      for (const err of ret) {
        let diagnosticUri = xmlURI;
        let lineNumber = parser.line - 1; // Convert to 0-based line
        let errorColumn = parser.column;
        let startColumn = 0;

        const currentInclude = includeLocationStack.length > 0 ? includeLocationStack[includeLocationStack.length - 1] : null;

        if (currentInclude) {
          // Error is inside an included file. Point to the include tag in the parent document.
          diagnosticUri = currentInclude.parentUri;
          lineNumber = currentInclude.line - 1; // Saxes line is 1-based.
          
          const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === diagnosticUri);
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
          const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === xmlURI.toString());
          if (document) {
              const lineText = document.lineAt(lineNumber).text;
              let errorCol0 = errorColumn - 1; // Convert to 0-based
              errorCol0 = Math.min(errorCol0, lineText.length - 1); // Ensure within bounds
      
              // Find the start of the tag by searching for '<' before the error column
              for (let i = errorCol0; i >= 0; i--) {
                  if (lineText[i] === '<') {
                      startColumn = i;
                      break;
                  }
              }
          }
        }
    
        // Create range from the start of the tag to the error column
        let range = new vscode.Range(lineNumber, startColumn, lineNumber, errorColumn);
        let diagnostics = diagnosticMap.get(xmlURI);
        if (!diagnostics) { diagnostics = []; }
    
        const names = err.getNames();
        const namesMsg = names.map((n: Base) => {
            const name = n.toJSON();
            let ns = name.ns ? `(${name.ns})` : '';
            return `"${name.name}" ${ns}`;
        }).join(' ');
    
        diagnostics.push(new vscode.Diagnostic(range, `${err.msg} — ${namesMsg}`));
        diagnosticMap.set(xmlURI, diagnostics);
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
    parser.on('processinginstruction', (pi) => {
      const getAttr = (name: string) => (pi.body.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
      if (pi.target === 'xml-xi-map-enter') {
        includeLocationStack.push({
          uri: getAttr('uri'),
          line: parseInt(getAttr('parent-line'), 10),
          column: parseInt(getAttr('parent-col'), 10),
          parentUri: getAttr('parent-uri'),
        });
      } else if (pi.target === 'xml-xi-map-leave') {
        const justLeft = includeLocationStack.pop();
        if (justLeft) {
          // The adjustment is the number of lines in the resolved document up to this point,
          // minus the original line number of the include tag. This gives the net lines added.
          lineAdjustment = (parser.line) - justLeft.line;
        }
      } else if (pi.target === 'xml-xi-error') {
        let diagnostics = diagnosticMap.get(xmlURI);
        if (!diagnostics) { diagnostics = []; };
        let range = new vscode.Range(parser.line - 1, parseInt(getAttr('parent-start'), 10), parser.line - 1, parseInt(getAttr('parent-col'), 10));

        diagnostics.push(new vscode.Diagnostic(range, `Could not resolve XInclude`));
        diagnosticMap.set(xmlURI, diagnostics);
      }
    });

    parser.on('opentag', (node: SaxesTag) => {
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
        uri: node.uri || '',
        local: node.local || '',
        hasContext: nsDefinitions.length !== 0,
      });
    });
  
    parser.on('text', (text: string) => {
      textBuf += text;
    });
  
    parser.on('closetag', () => {
      flushTextBuf();
      const tagInfo = tagStack.pop();
      if (tagInfo === undefined) {
        errorCount++;
        throw new Error("stack underflow");
      }
      fireEvent("endTag", [tagInfo.uri, tagInfo.local]);
      if (tagInfo.hasContext) {
        nameResolver.leaveContext();
      }
    });
  
    const entityRe = /^<!ENTITY\s+([^\s]+)\s+(['"])(.*?)\2\s*>\s*/;
  
    parser.on('doctype', (doctype: string) => {
      // This is an extremely primitive way to handle ENTITY declarations in a
      // DOCTYPE. It is unlikely to support any kind of complicated construct.
      // If a reminder need be given then: THIS PARSER IS NOT MEANT TO BE A
      // GENERAL SOLUTION TO PARSING XML FILES!!! It supports just enough to
      // perform some testing.
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
  
    parser.on('end', () => {
      const result = walker.end();
      if (result !== false) {
        error = ERR_WELLFORM;
        errorCount+=result.length;
        for (const err of result) {
          console.log(`on end`);
          console.log(err.toString());
        }
      }
    });
  
    parser.write(resolvedXmlSource).close();
  } catch(err) {
    errorCount++;
    const e = err as Error
    error = ERR_WELLFORM;
    let range = new vscode.Range(parser.line-1, 0, parser.line-1, parser.column);
    let diagnostics = diagnosticMap.get(xmlURI);
    if (!diagnostics) { diagnostics = []; }
    diagnostics.push(new vscode.Diagnostic(range, e.message));
    diagnosticMap.set(xmlURI, diagnostics);
  } 

  // Show diagnostics.
  diagnosticMap.forEach((diags, file) => {
    diagnosticCollection.set(vscode.Uri.parse(file), diags);
  });

  return {
    errorType: error,
    errorCount: errorCount,
    diagnostics: diagnosticMap.get(xmlURI) || [],
  };
}

// XPath notation returned by node-xsl-schematron is in Clark notation.
type ClarkName = { namespace: string; local: string };
type XPathStep = {
  name: ClarkName;
  index?: number;
  isAttribute?: boolean;
};

function parseXPath(xpath: string): XPathStep[] {
  const steps: XPathStep[] = [];
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

type NodePath = { ns: string; local: string; index: number };

function matchPath(path: NodePath[], steps: XPathStep[]): boolean {
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

// gives the xpath expression, finds the line number using saxes parser
async function locateSchErrInXML(xml: string, xpath: string): Promise<[number, number, number, number] | null> {
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

async function doValidation(): Promise<void> {

  console.log("validating...")
  if (validations.length > 0) {
    console.log("aborting latest validation process")
    for (const [index, v] of validations.entries()) {
      v.controller.abort();
      validations.splice(index, 1);
    }
  }

  const doSchematronValidation = (message: string, xmlURI: vscode.Uri, errorCount: number, diagnostics: vscode.Diagnostic[]): void => {
    console.log('Running schematron')
    vscode.window.setStatusBarMessage(`$(gear~spin) ${message}; checking Schematron`)
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    const fileText = activeEditor.document.getText();

    // Manual timeout to ensure UI updates take place (50ms)
    setTimeout(() => {
      sch.validate(fileText).then(async (errors: any) => {
        console.log('Ran schematron')
        const totalErrors = errors ?  errors.length + errorCount : errorCount
        vscode.window.setStatusBarMessage(totalErrors ? `$(error) ${message} Errors: ${totalErrors}` : `$(check) ${message}`);

        diagnosticCollection.clear();
        let schematronDiagnostics = [];

        if (errors){
          for (const err of errors) {
            const errLoc = await locateSchErrInXML(fileText, err.location);
            if (errLoc) {
              console.log(errLoc)
              const [startLine, startColumn, endLine, endColumn] = errLoc;
              const errorRange = new vscode.Range(startLine, startColumn, endLine, endColumn);
              schematronDiagnostics.push(new vscode.Diagnostic(errorRange, err.text));
            }
          }
        }

        diagnosticCollection.set(xmlURI, diagnostics.concat(schematronDiagnostics));
      });
    },50)
  }

  const schemaInfo = await locateSchema();

  // check if schemaInfo is defined and has a schema
  if (schemaInfo && schemaInfo.schema) {
    let isNewSchema = false;
    const {schema, schematron, fileText, xmlURI} = schemaInfo;
    const _xmlURI = xmlURI.toString();
    if (!grammarStore[_xmlURI]) {
      grammarStore[_xmlURI] = {};
    }
    const savedSchemaLoc = grammarStore[_xmlURI].rngURI;
    if (savedSchemaLoc !== schema) {
      // clean up
      grammarStore[_xmlURI].grammar = undefined;
      grammarStore[_xmlURI].rngURI = schema;
      isNewSchema = true;
    }

    const controller = new AbortController();
    const parsePromise = new Promise<void>(async (resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        console.log("aborting", controller.signal);
        return reject("Cancelled");
      })

      if (schema) {
        await parse(isNewSchema, schema, fileText, _xmlURI, schematron === EMBEDDED_SCH).then(({errorType, errorCount, diagnostics}) => {
          switch (errorType) {
            case ERR_VALID:
                vscode.window.setStatusBarMessage('$(error) XML is not valid.');
                doSchematronValidation("XML is not valid", xmlURI, errorCount, diagnostics);
              break;
            case ERR_WELLFORM:
              vscode.window.setStatusBarMessage('$(error) XML is not well formed.');
              break;
            case ERR_SCHEMA:
              vscode.window.setStatusBarMessage('$(error) RNG schema is incorrect.');
              doSchematronValidation("RNG schema is incorrect.", xmlURI, errorCount, diagnostics);
              break;
            default:
              vscode.window.setStatusBarMessage('$(check) XML is valid.');
              doSchematronValidation("XML is valid.", xmlURI, errorCount, diagnostics);
          }
          resolve();
        }).catch(() => reject());
      }
    })

    validations.push({
      parsePromise,
      controller
    })

    
  } else {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    const fileText = activeEditor.document.getText();
    const xmlURI = activeEditor.document.uri;
    parseWithoutSchema(fileText, xmlURI.toString()).then((err) => {
      switch (err) {
        case ERR_WELLFORM:
          vscode.window.setStatusBarMessage('$(error) XML is not well formed.');
          break;
        default:
          if (schemaInfo && schemaInfo.schematron) {
            doSchematronValidation("", xmlURI, 0, []);
          }
          vscode.window.setStatusBarMessage('$(check) XML is well formed.');
      }
    });

  }
}

// ACTIVATE

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "Scholarly XML" is now active.');
  const debounceDelay = 500;
  // Get supported languages from settings:
  const languages: string[] = vscode.workspace.getConfiguration("sxml").get("languagesToCheck") ?? ["xml"];
  // Check if active language is in list of supported languages, otherwise use xml
  const activeEditor = vscode.window.activeTextEditor;
  let validLang = "xml";
  if (activeEditor && languages.includes(activeEditor?.document.languageId)) {
    validLang = activeEditor.document.languageId;
  }

  // DIAGNOSTICS
  diagnosticCollection = vscode.languages.createDiagnosticCollection(validLang);
  context.subscriptions.push(diagnosticCollection);

  // COMPLETION PROPOSALS (with possible())
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'file', language: validLang }, new SalveCompletionProvider(grammarStore), '<', ' ', '"')
  );
  // COMMANDS
  let validate = vscode.commands.registerCommand('sxml.validate', async () => {
    await doValidation();
    return context;
  });
  let suggestAttValue = vscode.commands.registerTextEditorCommand(
    'sxml.suggestAttValue', (textEditor) => {
    const selection = textEditor?.selection;
    if (selection) {
      const nextCursor = selection.active.translate(0, -1);
      textEditor.selections = [new vscode.Selection(nextCursor, nextCursor)];
      vscode.commands.executeCommand('editor.action.triggerSuggest');
    }
  });
  let translateCursor = vscode.commands.registerTextEditorCommand(
    'sxml.translateCursor', (textEditor, edit, lineDelta: number, characterDelta: number) => {
    const selection = textEditor?.selection;
    if (selection) {
      const nextCursor = selection.active.translate(lineDelta, characterDelta);
      textEditor.selections = [new vscode.Selection(nextCursor, nextCursor)];
    }
  });
  let wrapWithEl = vscode.commands.registerTextEditorCommand(
    'sxml.wrapWithEl', (textEditor, edit, lineDelta: number, characterDelta: number) => {
    const selection = textEditor?.selection;
    if (selection) {
      vscode.window.showInputBox({
        value: '',
        placeHolder: 'Wrap selection with element: write element',
        validateInput: text => {
          // Make sure it's an XML Name
          if (text.match(XMLname)) {
            return null;
          }
          return "Must be an XML Name";
        }
      }).then(t => {
        if (t) {
          const wrapped = `<${t}>${textEditor.document.getText(selection)}</${t}>`;
          textEditor.edit(editBuilder => {
            editBuilder.replace(selection, wrapped);
          });
        }
      });
    }
  });

  // EVENTS

  // Validate file on save
  vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
    if (document.languageId === validLang && document.uri.scheme === "file") {
      vscode.commands.executeCommand('sxml.validate');
    }
  });

  vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
    if (event.document.languageId === validLang && event.document.uri.scheme === "file") {

      // Use debounce to avoid excessive validation calls

      // Clear the previous timer
      clearTimeout(validationTimer);
      
      // Set a new timer to run the validation after the delay
      validationTimer = setTimeout(async () => {
        await doValidation();
      }, debounceDelay);
    }
  });

  // Clear status after closing file.
  vscode.workspace.onDidCloseTextDocument(() => {
    vscode.window.setStatusBarMessage('');
  });

  // Clear status after changing file or trigger validation if new file is XML.
  vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined) => {
    vscode.window.setStatusBarMessage('');
    if (editor?.document.languageId === validLang && editor?.document.uri.scheme === "file") {
      await doValidation();
    }
  });

  context.subscriptions.push(validate, suggestAttValue, translateCursor, wrapWithEl);
  
  // Kick off on activation if the current file is XML
  if (activeEditor) {
    if (activeEditor.document.languageId === validLang) {
      doValidation();
    }
  }
}

// this method is called when the extension is deactivated
export function deactivate() {}
