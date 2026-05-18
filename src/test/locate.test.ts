import * as assert from "assert";
import * as vscode from "vscode";
import { locateSchema, locateSchematron } from "../services/locate";

function fakeDoc(content: string, fileName = "test.xml"): vscode.TextDocument {
  return {
    getText: () => content,
    fileName,
    uri: vscode.Uri.parse("file:///test.xml"),
  } as unknown as vscode.TextDocument;
}

suite("locate.ts", () => {

  suite("locateSchema", () => {
    test("finds href when it comes before schematypens", () => {
      const doc = fakeDoc(
        `<?xml-model href="test.rng" schematypens="http://relaxng.org/ns/structure/1.0"?><root/>`
      );
      const result = locateSchema(doc);
      assert.ok(result, "should return a schema URL");
      assert.ok(result!.includes("test.rng"));
    });

    test("finds href when schematypens comes first", () => {
      const doc = fakeDoc(
        `<?xml-model schematypens="http://relaxng.org/ns/structure/1.0" href="test.rng"?><root/>`
      );
      const result = locateSchema(doc);
      assert.ok(result!.includes("test.rng"));
    });

    test("returns undefined when no xml-model present", () => {
      const doc = fakeDoc(`<?xml version="1.0"?><root/>`);
      const result = locateSchema(doc);
      assert.strictEqual(result, undefined);
    });

    test("returns undefined when xml-model has no href", () => {
      const doc = fakeDoc(
        `<?xml-model schematypens="http://relaxng.org/ns/structure/1.0"?><root/>`
      );
      const result = locateSchema(doc);
      assert.strictEqual(result, undefined);
    });
  });

  suite("locateSchematron", () => {
    test("returns void when no schematron PI present", async () => {
      const doc = fakeDoc(`<?xml version="1.0"?><root/>`);
      const result = await locateSchematron(doc);
      assert.strictEqual(result, undefined);
    });

    test("detects embedded schematron when URI matches RNG", async () => {
      const rngURI = "file:///test.rng";
      const doc = fakeDoc(
        `<?xml-model href="test.rng" schematypens="http://purl.oclc.org/dsdl/schematron"?><root/>`
      );
      const result = await locateSchematron(doc, rngURI);
      assert.ok(result);
      assert.strictEqual(result!.embedded, true);
    });

    test("not embedded when URI differs from RNG", async () => {
      const doc = fakeDoc(
        `<?xml-model href="other.sch" schematypens="http://purl.oclc.org/dsdl/schematron"?><root/>`
      );
      const result = await locateSchematron(doc, "file:///test.rng");
      assert.ok(result);
      assert.strictEqual(result!.embedded, false);
    });
  });
});