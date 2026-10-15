import { XMLname } from "./constants";
import { commands, Range, Selection, SnippetString, window} from "vscode";
import { Formatter, FormatterError } from "tei-xml-fmt";
import { findTagPair, markupEnd } from "./services/autorename";
import { findParentElement, findSplitElement } from "./services/selection";


export const suggestAttValue = commands.registerTextEditorCommand(
  "sxml.suggestAttValue",
  (textEditor) => {
    const selection = textEditor?.selection;
    if (selection) {
      const nextCursor = selection.active.translate(0, -1);
      textEditor.selections = [new Selection(nextCursor, nextCursor)];
      commands.executeCommand("editor.action.triggerSuggest");
    }
  },
);

export const translateCursor = commands.registerTextEditorCommand(
  "sxml.translateCursor",
  (textEditor, edit, lineDelta: number, characterDelta: number) => {
    const selection = textEditor?.selection;
    if (selection) {
      const nextCursor = selection.active.translate(lineDelta, characterDelta);
      textEditor.selections = [new Selection(nextCursor, nextCursor)];
    }
  },
);

export const wrapWithEl = commands.registerTextEditorCommand(
  "sxml.wrapWithEl",
  (textEditor) => {
    const selection = textEditor?.selection;
    if (selection) {
      window
        .showInputBox({
          value: "",
          placeHolder: "Wrap selection with element: write element",
          validateInput: (text) => {
            if (text.match(XMLname)) {
              return null;
            }
            return "Must be an XML Name";
          },
        })
        .then((t) => {
          if (t) {
            const wrapped = `<${t}>${textEditor.document.getText(selection)}</${t}>`;
            textEditor.edit((editBuilder) => {
              editBuilder.replace(selection, wrapped);
            });
          }
        });
    }
  },
);

export const deleteTag = commands.registerTextEditorCommand(
  "sxml.deleteTag",
  (editor, edit) => {
    const doc = editor.document;
    const text = doc.getText();
    const pair = findTagPair(text, doc.offsetAt(editor.selection.active));
    if (!pair) return;
    const [open, close] = pair;

    const openEnd = markupEnd(text, open.end);
    const closeEnd = text.indexOf(">", close.end);
    if (openEnd < 0 || closeEnd < 0) return;

    edit.delete(
      new Range(doc.positionAt(close.start - 2), doc.positionAt(closeEnd + 1)),
    );
    edit.delete(
      new Range(doc.positionAt(open.start - 1), doc.positionAt(openEnd + 1)),
    );
  },
);

export const expandSelection = commands.registerTextEditorCommand(
    "sxml.expandSelection",
    (editor) => {
      const doc = editor.document;
      const text = doc.getText();
      editor.selections = editor.selections.map((sel) => {
        const range = findParentElement(
          text,
          doc.offsetAt(sel.start),
          doc.offsetAt(sel.end),
        );
        return range
          ? new Selection(doc.positionAt(range[0]), doc.positionAt(range[1]))
          : sel;
      });
    },
  );

  export const splitElement = commands.registerTextEditorCommand(
  "sxml.splitElement",
  (editor) => {
    const doc = editor.document;
    const pos = editor.selection.active;
    const name = findSplitElement(doc.getText(), doc.offsetAt(pos));
    if (!name) return;
    editor.edit((b) => b.insert(pos, `</${name}><${name}>`));
  },
);

export const insertForeign = commands.registerTextEditorCommand(
    "sxml.insertForeign",
    (editor) => {
      editor.insertSnippet(
        new SnippetString("<foreign>${0:$TM_SELECTED_TEXT}</foreign>"),
      );
    },
  );
