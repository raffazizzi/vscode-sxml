import * as vscode from 'vscode';
import { Formatter } from 'tei-xml-fmt';

/**
 * tei-xml-fmt never returns when anything (even a newline) follows the root element,
 * so format without the trailing whitespace and put it back afterwards.
 */
export function formatXML(text: string): string {
    let trimmed = text.trimEnd();
    return new Formatter().format(trimmed).trimEnd() + text.slice(trimmed.length);
}

export default class TEIXMLFormatterProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument) {
        let formattedText = formatXML(document.getText());
        return [
          vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0),
            document.positionAt(document.getText().length)),
            formattedText)
        ];
    }
}
