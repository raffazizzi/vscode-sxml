import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sxml from '../../extension';

const testFolderLocation = '../../../src/test/data/';
const samplesProvider = class implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri): string {
		switch (uri.toString()) {
			case 'sxml:rnguri':
				return `<?xml version="1.0" encoding="UTF-8"?>
					<?xml-model schematypens="http://relaxng.org/ns/structure/1.0" type="application/xml" href="test.rng"?>
					<root/>`;
			case 'sxml:rnguri_any':
				return `<?xml version="1.0" encoding="UTF-8"?>
					<?xml-model href="test.rng" schematypens="http://relaxng.org/ns/structure/1.0" type="application/xml"?>
					<root/>`;
			default:
				return '';
		}
  }
};
vscode.workspace.registerTextDocumentContentProvider('sxml', new samplesProvider());

suite('Scholarly XML Test Suite', async () => {
	vscode.window.showInformationMessage('Start all tests.');

	test(`Find a RelaxNG schema URL in a file`, async () => {		
		const uri = vscode.Uri.parse('sxml:rnguri');
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		
		const schemaInfo = sxml.locateSchema();
		assert.ok(schemaInfo);
		const { schema } = schemaInfo;
		assert.equal(schema, `file:///test.rng`);
	});

	test(`Find a RelaxNG schema URL in a file (any order)`, async () => {		
		const uri = vscode.Uri.parse('sxml:rnguri_any');
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		
		const schemaInfo = sxml.locateSchema();
		assert.ok(schemaInfo);
		const { schema } = schemaInfo;
		assert.equal(schema, `file:///test.rng`);
	});

	test('Validate a simple XML file with simple schema', async () => {
		// open file
		const uri = vscode.Uri.file(
		  path.join(__dirname, testFolderLocation, 'test.xml')
		);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);

		await vscode.commands.executeCommand('sxml.validate').then( async (context: any) => {
			await sleep(1000);
			const ctx = context as vscode.ExtensionContext;
			const diagnostics = ctx.subscriptions[0] as vscode.DiagnosticCollection;
			assert.equal(diagnostics.get(uri)?.length, 0);
		});
	})

	test('Validate a complex XML file with complex schema', async () => {
		// open file
		const uri = vscode.Uri.file(
		  path.join(__dirname, testFolderLocation, 'tei_all.xml')
		);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);

		await vscode.commands.executeCommand('sxml.validate').then( async (context: any) => {			
			const ctx = context as vscode.ExtensionContext;
			const diagnostics = ctx.subscriptions[0] as vscode.DiagnosticCollection;
			// wait for large file and schema to be loaded.
			await sleep(4000);
			// expect errors
			const d = diagnostics.get(uri);
			assert.ok(d);
			assert.ok(d.length > 0);
		});
	}).timeout(10000);
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
