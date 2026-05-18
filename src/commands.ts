import { XMLname } from "./constants";
import { commands, Range, Selection, window } from "vscode";
import { Formatter, FormatterError } from 'tei-xml-fmt';

export const suggestAttValue = commands.registerTextEditorCommand(
  'sxml.suggestAttValue', (textEditor) => {
  const selection = textEditor?.selection;
  if (selection) {
    const nextCursor = selection.active.translate(0, -1);
    textEditor.selections = [new Selection(nextCursor, nextCursor)];
    commands.executeCommand('editor.action.triggerSuggest');
  }
});

export const translateCursor = commands.registerTextEditorCommand(
  'sxml.translateCursor', (textEditor, edit, lineDelta: number, characterDelta: number) => {
  const selection = textEditor?.selection;
  if (selection) {
    const nextCursor = selection.active.translate(lineDelta, characterDelta);
    textEditor.selections = [new Selection(nextCursor, nextCursor)];
  }
});

export const wrapWithEl = commands.registerTextEditorCommand(
  'sxml.wrapWithEl', (textEditor) => {
  const selection = textEditor?.selection;
  if (selection) {
    window.showInputBox({
      value: '',
      placeHolder: 'Wrap selection with element: write element',
      validateInput: text => {
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

export const formatXml = commands.registerTextEditorCommand(
  'sxml.formatDocument', async (textEditor) => {
    const document = textEditor.document;
    const text = document.getText();

    try {
      const formatter = new Formatter();
      const formatted = formatter.format(text);

      const fullRange = new Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );

      textEditor.edit(editBuilder => {
        editBuilder.replace(fullRange, formatted);
      });
    } catch (err) {
      if (err instanceof FormatterError) {
        window.showErrorMessage(`Could not format: ${err.message}`);
      }
    }
  }
);