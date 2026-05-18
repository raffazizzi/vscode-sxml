import * as vscode from 'vscode';
import { Formatter } from 'tei-xml-fmt';

export default class TEIXMLFormatterProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument) {
        let texfmt = new Formatter();
        let formattedText = texfmt.format(document.getText());
        return [
          vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0),
            document.positionAt(document.getText().length)),
            formattedText)
        ];
    }
}