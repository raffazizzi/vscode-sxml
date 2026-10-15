import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import * as sxml from "../extension";

const testFolderLocation = "../../src/test/fixtures/";
const samplesProvider = class implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri): string {
		switch (uri.toString()) {
			case "sxml:rnguri":
				return `<?xml version="1.0" encoding="UTF-8"?>
					<?xml-model schematypens="http://relaxng.org/ns/structure/1.0" type="application/xml" href="test.rng"?>
					<root/>`;
			case "sxml:rnguri_any":
				return `<?xml version="1.0" encoding="UTF-8"?>
					<?xml-model href="test.rng" schematypens="http://relaxng.org/ns/structure/1.0" type="application/xml"?>
					<root/>`;
			default:
				return "";
		}
  }
};
vscode.workspace.registerTextDocumentContentProvider("sxml", new samplesProvider());

let context: vscode.ExtensionContext;

suite("Scholarly XML Test Suite", async () => {
	vscode.window.showInformationMessage("Starting all tests.");

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('raffazizzi.sxml');
    assert.ok(ext, 'Extension not found');
    context = await ext.activate();   // <-- triggers activate(context)
    console.log(context);
  });

	test("Validate a simple XML file with simple schema", async () => {
		// open file
		const uri = vscode.Uri.file(
		  path.join(__dirname, testFolderLocation, "test.xml")
		);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);

    
		await vscode.commands.executeCommand("sxml.validate").then( async () => {
      await sleep(1000);
			const ctx = context;
			const diagnostics = ctx.subscriptions[0] as vscode.DiagnosticCollection;
			assert.equal(diagnostics.get(uri)?.length, 0);
		});
	})

	test("Validate a complex XML file with complex schema", async () => {
		// open file
		const uri = vscode.Uri.file(
		  path.join(__dirname, testFolderLocation, "tei_all.xml")
		);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);

		await vscode.commands.executeCommand("sxml.validate").then( async () => {			
			const ctx = context;
			const diagnostics = ctx.subscriptions[0] as vscode.DiagnosticCollection;
			// expect errors
			const d = await waitForDiagnostics(diagnostics, uri);
			assert.ok(d.length > 0);
		});
	}).timeout(30000);
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// sxml.validate does not await validation, and the TEI schema is fetched over the
// network and compiled by salve, so there is no fixed delay that is both fast and
// reliable. Poll until diagnostics land, and fail with a useful message if they don't.
async function waitForDiagnostics(
  diagnostics: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  timeoutMs = 25000,
): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = diagnostics.get(uri);
    if (d && d.length > 0) {
      return d;
    }
    await sleep(250);
  }
  throw new Error(
    `no diagnostics reported for ${uri.fsPath} within ${timeoutMs}ms`
  );
}