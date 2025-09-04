import { suggestAttValue, translateCursor, wrapWithEl } from "./commands";
import { ERR_SCHEMA, ERR_VALID, ERR_WELLFORM } from "./constants";
import { XMLDocumentManager } from "./core/xmlDocumentManager";
import { validateDocument, validateWithSchematron } from "./services/validate";
import { commands, languages, window, workspace } from "vscode";

import type { DiagnosticCollection, ExtensionContext, TextDocument, TextDocumentChangeEvent, TextEditor } from "vscode";
import SalveCompletionProvider from "./services/suggest";

// Use Maps to hold a manager and a validator for each open XML document
const documentManagers = new Map<string, XMLDocumentManager>();
const validationControllers = new Map<string, AbortController>();

let diagnosticCollection: DiagnosticCollection;

async function getManager(document: TextDocument): Promise<XMLDocumentManager> {
    const uri = document.uri.toString();

    if (!documentManagers.has(uri)) {
      const newManager = new XMLDocumentManager()
      documentManagers.set(uri, newManager);
    }

    const dm = documentManagers.get(uri)!;
    await dm.updateDocument(document);
    return dm;
}

function makeStatusMsg(msg: string, icon: string, sch = false, tail?: string) {
  const _tail = tail ? ` ${tail}` : "";
  const fullMsg = `${msg}${_tail}`;
  return sch
    ? `$(gear~spin) ${fullMsg}; checking Schematron.`
    : `$(${icon}) ${fullMsg}.`
}

async function validate(document: TextDocument) {
  const uri = document.uri.toString();

  // If a validation is already running for this document, cancel it.
  if (validationControllers.has(uri)) {
    validationControllers.get(uri)?.abort();
  }
  const controller = new AbortController();
  validationControllers.set(uri, controller);

  try {
    // get document manager
    const manager = await getManager(document);

    // perform validation
    const validationResult = await validateDocument(manager, controller.signal);
    const hasSch = workspace.getConfiguration("sxml").get("schematronSupport")
      ? (await manager.getSchematron())?.hasOwnProperty("uri")
      : false;

    // If the signal was not aborted, update the UI.
    if (!controller.signal.aborted) {

      let msg = "";
      let tail;
      let icon = "error";
      if (validationResult) {
        // Update status
        switch (validationResult.errorType) {
          case ERR_VALID: 
            msg = `XML is not valid.`;
            tail = `Found ${validationResult.errorCount} errors`;
            break;
          case ERR_WELLFORM: 
            msg = "XML is not well formed.";
            break;
          case ERR_SCHEMA: 
            msg = "RNG schema is incorrect.";
            break;
          default:
            msg = "XML is valid against RNG grammar.";
            icon = "check";
        }
        window.setStatusBarMessage(makeStatusMsg(msg, icon, Boolean(hasSch), tail));
        diagnosticCollection.set(document.uri, validationResult.diagnostics);
      }

      // Perform schematron validation only after reporting on RNG validation, because it's slower.
      if (hasSch) {
        const schValidationResult = await validateWithSchematron(manager, controller.signal);
        if (schValidationResult && schValidationResult.errorCount > 0) {

          // join schema and schematron diagnostics.
          const diagnostics = ((validationResult && validationResult.diagnostics) || [])
            .concat((schValidationResult && schValidationResult.diagnostics) || []);

          // report
          diagnosticCollection.set(document.uri, diagnostics);

          const totalErrors = schValidationResult.errorCount + ((validationResult && validationResult.errorCount) || 0)

          // update status
          const newMsg = makeStatusMsg("XML is not valid after Schematron validation", "error", false);

          window.setStatusBarMessage(`${newMsg} Found ${totalErrors} errors.`);
        } else if (validationResult) {
          window.setStatusBarMessage(makeStatusMsg(msg, icon, false, tail));
        }
      }
    }

  } catch (error) {
    // Handle cancellation errors if the service throws them
    if ((error as Error).name === "AbortError") {
        console.log(`Validation for ${uri} was aborted.`);
    }
  } finally {
    // Once done (or aborted), remove the controller from the map.
    validationControllers.delete(uri);
  }
}

export const validateCommand = commands.registerTextEditorCommand("sxml.validate", async () => {
  const {activeTextEditor} = window; // Get current editor
  const supportedLangs: string[] = workspace.getConfiguration("sxml").get("languagesToCheck") ?? ["xml"];
  
  if (activeTextEditor && supportedLangs.includes(activeTextEditor.document.languageId)) {
    validate(activeTextEditor.document);
  }
});

// ACTIVATE
export function activate(context: ExtensionContext) {
  console.log(`Extension "Scholarly XML" is now active.`);
  
  // Track last keystroke time
  let lastKeystroke = Date.now();
  let checkTimer: NodeJS.Timeout | undefined = undefined;
  const typeDelay = 500;

  // Get supported languages from settings:
  const supportedLangs: string[] = workspace.getConfiguration("sxml").get("languagesToCheck") ?? ["xml"];

  // DIAGNOSTICS
  diagnosticCollection = languages.createDiagnosticCollection("xml-validation");
  context.subscriptions.push(diagnosticCollection);

  // COMPLETIONS PROVIDER
  languages.registerCompletionItemProvider(supportedLangs, new SalveCompletionProvider(getManager), '<', ' ', '"')

  // EVENTS
  workspace.onDidChangeTextDocument((event: TextDocumentChangeEvent) => {
    if (supportedLangs.includes(event.document.languageId) && event.document.uri.scheme === "file") {
      lastKeystroke = Date.now();

      // Clear existing timer
      if (checkTimer) {
        clearTimeout(checkTimer);
      }
      
      // Set up check for typing pause
      checkTimer = setTimeout(() => {
        const timeSinceLastKeystroke = Date.now() - lastKeystroke;
        if (timeSinceLastKeystroke >= typeDelay) {
          validate(event.document);
        }
      }, typeDelay);
    }
  });

  // Clear status after closing file.
  workspace.onDidCloseTextDocument(() => {
    window.setStatusBarMessage("");
  });

  // Clear status after changing file or trigger validation if new file is XML.
  window.onDidChangeActiveTextEditor(async (editor: TextEditor | undefined) => {
    window.setStatusBarMessage("");
    if (editor && editor.document && supportedLangs.includes(editor.document.languageId) && editor.document.uri.scheme === "file") {
      validate(editor.document);
    }
  });

  context.subscriptions.push(validateCommand, suggestAttValue, translateCursor, wrapWithEl);
  
  // Kick off on activation.
  commands.executeCommand("sxml.validate");
}

// this method is called when the extension is deactivated
export function deactivate() {}
