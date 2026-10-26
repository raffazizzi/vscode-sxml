import * as assert from "assert";
import * as path from "path";
import { pathToFileURL } from "url";
import { workspace } from "vscode";
import { convertRNGToPattern } from "salve-annos";
import type { Grammar } from "salve-annos";
import { XMLDocumentManager } from "../core/XMLDocumentManager";
import { validateDocument } from "../services/validate";
import { ERR_WELLFORM } from "../constants";

suite("Entity error highlighting", () => {
  let grammar: Grammar;

  suiteSetup(async () => {
    const uri = pathToFileURL(path.join(__dirname, "../../src/test/fixtures/entities.rng"));
    grammar = (await convertRNGToPattern(uri)).pattern;
  });

  for (const withSchema of [false, true]) {
    suite(withSchema ? "with a schema" : "without a schema", () => {
      for (const [name, content, bad] of [
        ["later semicolon", "<root>\n&<tag>asdasd</tag>\nmore text <tag>sdf</tag>\ntext;</root>", "&"],
        ["no semicolon", "<root>\n&<tag>asdasd</tag>\nmore text <tag>sdf</tag>\ntext</root>", "&"],
        ["unfinished name", "<root>&amp</root>", "&amp"],
        ["bare ampersand at EOF", "<root>text &", "&"],
        ["attribute value", '<root value="a & b"/>', "&"],
        ["single-quoted attribute", "<root value='&amp'/>", "&amp"],
        ["empty name", "<root>&;</root>", "&;"],
        ["invalid decimal reference", "<root>&#12z;</root>", "&#12z;"],
        ["invalid hex reference", "<root>&#xGG;</root>", "&#xGG;"],
        ["missing numeric digits", "<root>&#x;</root>", "&#x;"],
        ["invalid name", "<root>&1bad;</root>", "&1bad;"],
        ["valid reference before error", "<root>&amp; then &bad word;</root>", "&bad"],
        ["CRLF and Unicode", "<root>\r\n😀 &bad text;</root>", "&bad"],
        ["CR line endings", "<root>\rtext &bad text;</root>", "&bad"],
      ]) {
        test(name, async () => {
          const document = await workspace.openTextDocument({ language: "xml", content });
          const manager = new XMLDocumentManager();
          await manager.updateDocument(document);
          manager.getGrammar = async () => withSchema ? grammar : undefined;
          const result = await validateDocument(manager, new AbortController().signal);
          assert.ok(result);
          assert.strictEqual(result.errorType, ERR_WELLFORM);
          assert.strictEqual(result.errorCount, 1);
          const diagnostic = result.diagnostics[0];
          const start = content.indexOf(bad);
          assert.strictEqual(document.offsetAt(diagnostic.range.start), start);
          assert.strictEqual(document.offsetAt(diagnostic.range.end), start + bad.length);
          assert.match(diagnostic.message, /entity reference/i);
        });
      }

      for (const [name, content] of [
        ["predefined and numeric references", '<root value="&quot;&apos;">&amp;&lt;&gt;&#65;&#x1F600;</root>'],
        ["comment", "<root><!-- &<tag>bad; --></root>"],
        ["CDATA", "<root><![CDATA[&<tag>bad;]]></root>"],
        ["processing instruction", "<?example &bad?><root/>"],
        ["doctype", '<!DOCTYPE root [<!-- &bad --><!ENTITY example "ok">]><root/>'],
      ]) {
        test(`accepts ${name}`, async () => {
          const document = await workspace.openTextDocument({ language: "xml", content });
          const manager = new XMLDocumentManager();
          await manager.updateDocument(document);
          manager.getGrammar = async () => withSchema ? grammar : undefined;
          const result = await validateDocument(manager, new AbortController().signal);
          assert.ok(result);
          assert.strictEqual(result.errorCount, 0);
        });
      }

      test("keeps normal tag errors", async () => {
        const document = await workspace.openTextDocument({ language: "xml", content: "<root><tag></root>" });
        const manager = new XMLDocumentManager();
        await manager.updateDocument(document);
        manager.getGrammar = async () => withSchema ? grammar : undefined;
        const result = await validateDocument(manager, new AbortController().signal);
        assert.ok(result);
        assert.ok(result.errorCount > 0);
        assert.ok(result.diagnostics.some(d => /tag/i.test(d.message)));
      });
    });
  }
  test("uses original positions after XInclude expansion", async () => {
    const include = pathToFileURL(path.join(__dirname, "../../src/test/fixtures/entity-include.xml")).href;
    const content = `<root xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="${include}"/> &bad text;</root>`;
    const document = await workspace.openTextDocument({ language: "xml", content });
    const manager = new XMLDocumentManager();
    await manager.updateDocument(document);
    assert.notStrictEqual(manager.documentText, content);
    for (const withSchema of [false, true]) {
      manager.getGrammar = async () => withSchema ? grammar : undefined;
      const result = await validateDocument(manager, new AbortController().signal);
      assert.ok(result);
      assert.strictEqual(document.offsetAt(result.diagnostics[0].range.start), content.indexOf("&bad"));
      assert.strictEqual(document.offsetAt(result.diagnostics[0].range.end), content.indexOf("&bad") + 4);
    }
  });

  test("keeps schema errors for well-formed XML", async () => {
    const uri = pathToFileURL(path.join(__dirname, "../../src/test/fixtures/test.rng"));
    const document = await workspace.openTextDocument({ language: "xml", content: "<wrong/>" });
    const manager = new XMLDocumentManager();
    await manager.updateDocument(document);
    const schema = (await convertRNGToPattern(uri)).pattern;
    manager.getGrammar = async () => schema;
    const result = await validateDocument(manager, new AbortController().signal);
    assert.ok(result);
    assert.ok(result.errorCount > 0);
    assert.ok(result.diagnostics.length > 0);
  });

  test("accepts declared entities with a schema", async () => {
    const content = '<!DOCTYPE root [<!ENTITY custom "example">]><root>&custom;</root>';
    const document = await workspace.openTextDocument({ language: "xml", content });
    const manager = new XMLDocumentManager();
    await manager.updateDocument(document);
    manager.getGrammar = async () => grammar;
    const result = await validateDocument(manager, new AbortController().signal);
    assert.ok(result);
    assert.strictEqual(result.errorCount, 0);
  });

  test("does not report errors after cancellation", async () => {
    const document = await workspace.openTextDocument({ language: "xml", content: "<root>&</root>" });
    const manager = new XMLDocumentManager();
    await manager.updateDocument(document);
    const controller = new AbortController();
    controller.abort();
    assert.strictEqual(await validateDocument(manager, controller.signal), undefined);
  });

});
