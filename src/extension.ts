import * as vscode from 'vscode';
import SalveCompletionProvider from './completion';
import 'cross-fetch/polyfill';
import * as url from 'url';
import * as path from 'path';
import {Grammar, convertRNGToPattern, DefaultNameResolver, Name} from 'salve-annos';
import fileUrl from "file-url";
import { SaxesParser, SaxesTag, SaxesAttributeNS } from "saxes";
// @ts-ignore: No types defined
import Schematron from "./tmpsch/Schematron";
// import { DOMParser, XMLSerializer } from 'xmldom';
// import * as xpath from 'xpath';

const ERR_VALID = 'ERR_VALID';
const ERR_WELLFORM = 'ERR_WELLFORM';
const ERR_SCHEMA = 'ERR_SCHEMA';
const NO_ERR = 'NO_ERR';


// XML Name regex (minus : and [#x10000-#xEFFFF] range)
const nameStartChar = new RegExp(/_|[A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
const nameChar = new RegExp(`${nameStartChar.source}|-|\\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]`);
const XMLname = new RegExp(`^(${nameStartChar.source})(${nameChar.source})*$`);

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

export function locateSchema(): {schema: string, fileText: string, xmlURI: vscode.Uri} | void {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }
  
  const fileText = activeEditor.document.getText();
  const xmlURI = activeEditor.document.uri;

  // Locate RNG
  let schemaURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0"/s);
  // Retry with schematypens first
  schemaURLMatch = schemaURLMatch ? schemaURLMatch : fileText.match(/<\?xml-model.+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0".+?href="([^"]+)"/s);

  if (!schemaURLMatch) {
    return;
  } else {
    const schemaURL = schemaURLMatch[1];
    // Start by assuming it's a full URL.
    let schema = schemaURL;

    // Determine whether it's a path.
    if (path.parse(schemaURL).root) {
      // This is a local absolute path
      schema = fileUrl(schemaURL, {resolve: false});
    } else if (!url.parse(schemaURL).protocol) {
      // This is NOT a full URL, so treat this as a relative path
      const path = activeEditor.document.uri.path.split('/').slice(0, -1).join('/');
      schema = fileUrl(path + '/' + schemaURL, {resolve: false});
    }
    return {schema, fileText, xmlURI};
  }
}

export async function grammarFromSource(rngSource: string): Promise<Grammar | void> {
	// Treat it as a Relax NG schema.
  const schemaURL = new URL(rngSource);
  try {
    const s = await convertRNGToPattern(schemaURL);
    // s.schemaText --> use this for schematron validation
    await sch.setRNG(s.schemaText);
    return s.pattern;
  } catch(err) {
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

async function parse(isNewSchema: boolean, rngSource: string, xmlSource: string, xmlURI: string): Promise<{errorType: string, errorCount: number, diagnostics: vscode.Diagnostic[]}> {
  // Parsing function adapted from 
  // https://github.com/mangalam-research/salve/blob/0fd149e44bc422952d3b095bfa2cdd8bf76dd15c/lib/salve/parse.ts
  // Mozilla Public License 2.0

  const parser = new SaxesParser({ xmlns: true, position: true });
  let tree: void | Grammar | null = null;
  let errorCount = 0;

  // Only get grammar from source if necessary.
  if (!isNewSchema) {
    tree = grammarStore[xmlURI].grammar;
  }
  if (!tree) {
    tree = await grammarFromSource(rngSource);
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

  function fireEvent(name: string, args: any[]): void {
		const ret = walker.fireEvent(name, args);
    if (ret instanceof Array) {
      error = ERR_VALID;
      errorCount += ret.length;

			// for (const err of ret) {
      //   console.log(parser)
      //   let range = new vscode.Range(parser.line-1, 0, parser.line-1, parser.column);
      //   let diagnostics = diagnosticMap.get(xmlURI);
      //   if (!diagnostics) { diagnostics = []; }
      //   const names = err.getNames();
      //   // TODO: Temporarily setting this to any
      //   const namesMsg = names.map((n: any) => {
      //     const name = n.toJSON();
      //     let ns = name.ns ? `(${name.ns})` : '';
      //     return `"${name.name}" ${ns}`;
      //   }).join(' ');
      //   diagnostics.push(new vscode.Diagnostic(range, 
      //     `${err.msg} — ${namesMsg}`));
      //   diagnosticMap.set(xmlURI, diagnostics);
      // }

      for (const err of ret) {
        const lineNumber = parser.line - 1; // Convert to 0-based line
        const errorColumn = parser.column; // Assuming this is 1-based column
    
        let startColumn = 0;
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
    
        // Create range from the start of the tag to the error column
        let range = new vscode.Range(lineNumber, startColumn, lineNumber, errorColumn);
        let diagnostics = diagnosticMap.get(xmlURI);
        if (!diagnostics) { diagnostics = []; }
    
        const names = err.getNames();
        const namesMsg = names.map((n) => {
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
  
    parser.write(xmlSource).close();
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

//xpath given by schematron has more data than needed
//converts that custom xpath into its simpler version
// /Q{...}tagName[index]/.../Q{...}tagName[index] ---> tagName[index]/.../tagName[index]
function convertCustomXPath(customXPath: string): string {
  const xPathComponents = customXPath.split('/Q').filter(Boolean);

  const prefixedComponents = xPathComponents.map(component => {
      const match = component.match(/^{([^}]+)}(.*)$/);
      if (match) {
        const elementName = match[2];
        return `${elementName}`;
      }
      return component;
  });

  return prefixedComponents.join('/');
}

// finds first and last column numbers in a given line
// added for the look of the error reporting not underlining whitespace
// No longer used
function getColumnNumbersFromLine(lineNumber: number): [number, number] | null {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
      return null;
  }

  const lineText = activeEditor.document.lineAt(lineNumber).text;

  const trimmedLineText = lineText.trim();

  if (trimmedLineText.length === 0) {
      return null;
  }

  const firstNonWhitespaceIndex = lineText.indexOf(trimmedLineText);
  const lastNonWhitespaceIndex = firstNonWhitespaceIndex + trimmedLineText.length - 1;

  return [firstNonWhitespaceIndex, lastNonWhitespaceIndex];
}

//helper function for processXML to see if the two xpaths are a match
function matchesXPath(currentPath: string[], xpath: string[]): boolean {
  if (currentPath.length !== xpath.length) return false;
  for (let i = 0; i < xpath.length; i++) {
      if (xpath[i] !== currentPath[i] && xpath[i] !== '*') {
          return false;
      }
  }
  return true;
}

//gives the xpath expression, finds the line number using saxes parser
// async function processXML(xml: string, xpathExpression: string): Promise<[number,number, number]> {
//   const parser = new SaxesParser({ position: true }); 
//   const xpath = xpathExpression.split('/').filter(Boolean);
//   const currentPath: string[] = [];
//   let lastTag: string | undefined;

//   let line = -1;
//   let column = -1;

//   parser.on('opentag', (node: SaxesTag) => {
//       // for when the index in xpath isn't [1]
//       const match = lastTag?.match(/^(.*)\[(\d)\]$/);
//       if (match && match[1] === node.name) {
//         currentPath.push(node.name + `[${String(Number(match[2]) + 1)}]`);
//       }
//       else {
//         currentPath.push(node.name + "[1]");
//       }

//       if (matchesXPath(currentPath, xpath)) {
//           line = parser.line - 1;
//           column = parser.column - 1;
//       }
//   });

//   parser.on('closetag', () => {
//       lastTag = currentPath.pop();
//   });

//   parser.on('error', (error: Error) => {
//       console.error('Error:', error);
//   });

//   parser.write(xml).close();
//   return [line,0, column];
// }

// gives the xpath expression, finds the line number using saxes parser
async function processXML(xml: string, xpathExpression: string): Promise<[number, number, number, number]> {
  const parser = new SaxesParser({ position: true });
  const xpath = xpathExpression.split('/').filter(Boolean);
  const currentPath: string[] = [];
  let lastTag: string | undefined;

  // Track start/end positions of the opening tag
  let startLine = -1;
  let startColumn = -1;
  let endLine = -1;
  let endColumn = -1;
  const tagStartStack: Array<{ line: number, column: number }> = [];

  parser.on('opentagstart', () => {
    // Record the position where the opening tag starts ("<")
    tagStartStack.push({
      line: parser.line - 1, // Convert to 0-based
      column: parser.column - 1,
    });
  });

  parser.on('opentag', (node: SaxesTag) => {
    // Get the start position from the stack
    const tagStart = tagStartStack.pop();
    if (!tagStart) return;

    // Update currentPath (existing logic)
    const match = lastTag?.match(/^(.*)\[(\d+)\]$/);
    if (match && match[1] === node.name) {
      currentPath.push(`${node.name}[${Number(match[2]) + 1}]`);
    } else {
      currentPath.push(`${node.name}[1]`);
    }

    // Check if this tag matches the XPath
    if (matchesXPath(currentPath, xpath)) {
      // get start/end positions of the opening tag
      startLine = tagStart.line;
      startColumn = tagStart.column;
      endLine = parser.line - 1; // Position after ">"
      endColumn = parser.column - 1;
    }
  });

  parser.on('closetag', () => {
    lastTag = currentPath.pop();
  });

  parser.on('error', (error: Error) => {
    console.error('Error:', error);
  });

  parser.write(xml).close();
  return [startLine, startColumn, endLine, endColumn];
}

function doValidation(): void {

  console.log("validating...")
  if (validations.length > 0) {
    console.log(validations)
    console.log("aborting latest validation process")
    for (const [index, v] of validations.entries()) {
      v.controller.abort();
      validations.splice(index, 1);
    }
  }

  const doSchematronValidation = (message: string, errorCount: number, diagnostics: vscode.Diagnostic[]): void => {
    vscode.window.setStatusBarMessage('$(gear~spin) XML is valid; checking Schematron');
    console.log(message)
    console.log('Running schematron')
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    const fileText = activeEditor.document.getText(); 

    const results = sch.validate(fileText).then(async (errors: any) => {
      console.log('Ran schematron')
      const totalErrors = errors ?  errors.length + errorCount : errorCount
      vscode.window.setStatusBarMessage(totalErrors ? `${message} Errors: ${totalErrors}` : message);

      diagnosticCollection.clear();
      let schematronDiagnostics = [];

      console.log(errors)
      if (errors){
        for (const err of errors) {
          const xpath = convertCustomXPath(err.location);
          const [startLine, startColumn, endLine, endColumn] = await processXML(fileText, xpath);

          const errorRange = new vscode.Range(startLine, startColumn, endLine, endColumn);
          schematronDiagnostics.push(new vscode.Diagnostic(errorRange, err.text));
        }
      }

      const schemaInfo = locateSchema();
      if (schemaInfo) {
        const {xmlURI} = schemaInfo;
        diagnosticCollection.set(xmlURI, diagnostics.concat(schematronDiagnostics));
      }
    });
  }

  const schemaInfo = locateSchema();

  if (schemaInfo) {
    let isNewSchema = false;
    const {schema, fileText, xmlURI} = schemaInfo;
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
      await parse(isNewSchema, schema, fileText, _xmlURI).then(({errorType, errorCount, diagnostics}) => {
        switch (errorType) {
          case ERR_VALID:
            console.log("XML is not valid.");
            vscode.window.setStatusBarMessage('$(gear~spin) XML is not valid; checking Schematron');
            doSchematronValidation("$(error) XML is not valid.", errorCount, diagnostics);
            break;
          case ERR_WELLFORM:
            vscode.window.setStatusBarMessage('$(error) XML is not well formed.');
            break;
          case ERR_SCHEMA:
            vscode.window.setStatusBarMessage('$(gear~spin) RNG schema is incorrect; checking Schematron');
            doSchematronValidation("$(error) RNG schema is incorrect.", errorCount, diagnostics);
            console.log("RNG schema is incorrect.");
            break;
          default:
            vscode.window.setStatusBarMessage('$(gear~spin) XML is valid; checking Schematron');
            doSchematronValidation("$(check) XML is valid.", errorCount, diagnostics);
        }
        resolve();
      }).catch(() => reject());
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
          vscode.window.setStatusBarMessage('$(check) XML is well formed.');
      }
    });

  }
}

// ACTIVATE

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "Scholarly XML" is now active.');

  // DIAGNOSTICS
  diagnosticCollection = vscode.languages.createDiagnosticCollection('xml');
  context.subscriptions.push(diagnosticCollection);

  // COMPLETION PROPOSALS (with possible())
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'file', language: 'xml' }, new SalveCompletionProvider(grammarStore), '<', ' ', '"')
  );
  // COMMANDS
  let validate = vscode.commands.registerCommand('sxml.validate', () => {
    doValidation();
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
    if (document.languageId === "xml" && document.uri.scheme === "file") {
      vscode.commands.executeCommand('sxml.validate');
    }
  });

  vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
    if (event.document.languageId === "xml" && event.document.uri.scheme === "file") {
      doValidation();
    }
  });

  // Clear status after closing file.
  vscode.workspace.onDidCloseTextDocument(() => {
    vscode.window.setStatusBarMessage('');
  });

  // Clear status after changing file or trigger validation if new file is XML.
  vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
    vscode.window.setStatusBarMessage('');
    if (editor?.document.languageId === "xml" && editor?.document.uri.scheme === "file") {
      doValidation();
    }
  });

  context.subscriptions.push(validate, suggestAttValue, translateCursor, wrapWithEl);
  
  // Kick off on activation if the current file is XML
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    if (activeEditor.document.languageId === 'xml') {
      doValidation();
    }
  }
}

// this method is called when your extension is deactivated
export function deactivate() {}
	