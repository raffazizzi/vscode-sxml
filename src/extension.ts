import * as vscode from 'vscode';
import SalveCompletionProvider from './completion';
import 'cross-fetch/polyfill';
import * as url from 'url';
import * as path from 'path';
import {Grammar, convertRNGToPattern, DefaultNameResolver, Name} from 'salve';
import * as fileUrl from "file-url";
import { SaxesParser, SaxesTag, SaxesAttributeNS } from "saxes";

const ERR_VALID = 'ERR_VALID';
const ERR_WELLFORM = 'ERR_WELLFORM';
const NO_ERR = 'NO_ERR';

let diagnosticCollection: vscode.DiagnosticCollection;

type TagInfo = {
  uri: string;
  local: string;
  hasContext: boolean;
};

export async function grammarFromSource(rngSource: string): Promise<Grammar | void> {
	// Treat it as a Relax NG schema.
  const schemaURL = new URL(rngSource);
  try {
    await convertRNGToPattern(schemaURL);
    return (await convertRNGToPattern(schemaURL)).pattern;
  } catch {
    vscode.window.showInformationMessage('Could not retrieve schema.');
  }
}

async function parse(rngSource: string, xmlSource: string, xmlURI: string): Promise<String> {
  // Parsing function adapted from 
  // https://github.com/mangalam-research/salve/blob/0fd149e44bc422952d3b095bfa2cdd8bf76dd15c/lib/salve/parse.ts
  // Mozilla Public License 2.0

  const parser = new SaxesParser({ xmlns: true, position: true });

  const tree = await grammarFromSource(rngSource);
  if (!tree) {
    return ERR_WELLFORM;
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
			for (const err of ret) {
        let range = new vscode.Range(parser.line-1, 0, parser.line-1, parser.column);
        let diagnostics = diagnosticMap.get(xmlURI);
        if (!diagnostics) { diagnostics = []; }
        const names = err.getNames();
        const namesMsg = names.map((n: Name) => {
          const name = n.toJSON();
          let ns = name.ns ? `(${name.ns})` : '';
          return `"${name.name}" ${ns}`;
        }).join(' ');
        diagnostics.push(new vscode.Diagnostic(range, 
          `${err.msg} — ${namesMsg}`));
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
          throw new Error(`unexpected construct in DOCTYPE: ${doctype}`);
        }
      }
    });
  
    parser.on('end', () => {
      const result = walker.end();
      if (result !== false) {
        error = ERR_WELLFORM;
        for (const err of result) {
          console.log(`on end`);
          console.log(err.toString());
        }
      }
    });
  
    parser.write(xmlSource).close();
  } catch(err) {
    error = ERR_WELLFORM;
    let range = new vscode.Range(parser.line-1, 0, parser.line-1, parser.column);
    let diagnostics = diagnosticMap.get(xmlURI);
    if (!diagnostics) { diagnostics = []; }
    diagnostics.push(new vscode.Diagnostic(range, err.message));
    diagnosticMap.set(xmlURI, diagnostics);
  } 

  // Show diagnostics.
  diagnosticMap.forEach((diags, file) => {
    diagnosticCollection.set(vscode.Uri.parse(file), diags);
  });

  return error;
}

export function loadSchema(): {schema: string, fileText: string, xmlURI: vscode.Uri} | void {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }
  
  const fileText = activeEditor.document.getText();
  const xmlURI = activeEditor.document.uri;

  // Locate RNG
  let schemaURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".*?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0"/);
  // Retry with schematypens first
  schemaURLMatch = schemaURLMatch ? schemaURLMatch : fileText.match(/<\?xml-model.*?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0".*?href="([^"]+)"/);

  if (!schemaURLMatch) {
    vscode.window.showInformationMessage('No associated RelaxNG schema.');
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
      return {schema, fileText, xmlURI};
    }
  }
}

function doValidation(state: vscode.Memento): void {
  const schemaData = loadSchema();
  if (schemaData) {
    const {schema, fileText, xmlURI} = schemaData;
    parse(schema, fileText, xmlURI.toString()).then((err) => {
      switch (err) {
        case ERR_VALID:
          vscode.window.setStatusBarMessage('$(error) XML is not valid.');
          break;
        case ERR_WELLFORM:
          vscode.window.setStatusBarMessage('$(error) XML is not well formed.');
          break;
        default:
          vscode.window.setStatusBarMessage('$(check) XML is valid.');
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
      { scheme: 'file', language: 'xml' }, new SalveCompletionProvider(context.workspaceState), '<', ' ', '"')
  );

  // COMMANDS
  let validate = vscode.commands.registerCommand('sxml.validate', () => {
		doValidation(context.workspaceState);
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

  // EVENTS

  // Validate file on save
  vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
    if (document.languageId === "xml" && document.uri.scheme === "file") {
      vscode.commands.executeCommand('sxml.validate');
    }
  });

  vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
    if (event.document.languageId === "xml" && event.document.uri.scheme === "file") {
      context.workspaceState.update('schema', loadSchema());
      doValidation(context.workspaceState);
    }
  });

  // Clear status after closing file.
  vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
    vscode.window.setStatusBarMessage('');
  });

  // Clear status after changing file or trigger validation if new file is XML.
  vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
    vscode.window.setStatusBarMessage('');
    if (editor?.document.languageId === "xml" && editor?.document.uri.scheme === "file") {
      context.workspaceState.update('schema', loadSchema());
      doValidation(context.workspaceState);
    }
  });

	context.subscriptions.push(validate, suggestAttValue, translateCursor);
}

// this method is called when your extension is deactivated
export function deactivate() {}
	