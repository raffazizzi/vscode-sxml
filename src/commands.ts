import { XMLname } from "./constants";
import { commands, Selection, window } from "vscode";

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