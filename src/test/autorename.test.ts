import * as assert from "assert";
import { findTagPair } from "../services/autorename";
import { XMLname } from "../constants";

suite("findTagPair", () => {
  test("finds the pair when the cursor is in the opening tag name", () => {
    const text = "<a><b>x</b></a>";
    const pair = findTagPair(text, text.indexOf("<b>") + 1);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "b");
    assert.strictEqual(pair[0].start, text.indexOf("<b>") + 1);
    assert.strictEqual(pair[1].start, text.indexOf("</b>") + 2);
  });

  test("finds the same pair when the cursor is in the closing tag name", () => {
    const text = "<a><b>x</b></a>";
    const pair = findTagPair(text, text.indexOf("</b>") + 2);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "b");
  });

  test("returns the outer pair for the outer tag, not the inner one", () => {
    const text = "<outer><inner>t</inner></outer>";
    const pair = findTagPair(text, text.indexOf("<outer>") + 1);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "outer");
  });

  test("supports prefixed names", () => {
    const text = "<e:ext></e:ext>";
    const pair = findTagPair(text, 2);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "e:ext");
  });

  test("handles '>' inside an attribute value", () => {
    const text = '<a href="1>2">t</a>';
    const pair = findTagPair(text, text.indexOf("<a") + 1);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "a");
  });

  test("returns undefined for a self-closing tag", () => {
    const text = "<a><br/></a>";
    assert.strictEqual(findTagPair(text, text.indexOf("<br") + 1), undefined);
  });

  test("returns undefined for mismatched tags", () => {
    const text = "<a></b>";
    assert.strictEqual(findTagPair(text, 1), undefined);
  });

  test("ignores tags inside comments", () => {
    const text = "<!-- <x></x> --><a></a>";
    assert.strictEqual(findTagPair(text, text.indexOf("<x>") + 1), undefined);
  });

  test("returns undefined when the cursor is in text content", () => {
    const text = "<a>text</a>";
    assert.strictEqual(findTagPair(text, text.indexOf("text")), undefined);
  });
});

suite("XMLname (QName)", () => {
  const ok = ["note", "tei:note", "xml:id", "_x", "a-b", "\u540D\u524D"];
  const no = ["a:b:c", ":lead", "note:", "tei::note", "tei:1bad", "1bad", "", "a b"];
  test("accepts a name or a single prefix", () =>
    ok.forEach((n) => assert.ok(XMLname.test(n), n)));
  test("rejects malformed prefixes", () =>
    no.forEach((n) => assert.ok(!XMLname.test(n), n)));
});

suite("the scanner is looser than XMLname on purpose", () => {
  // A strict QName here would make findTagPair bail on <a:b:c> and kill linked
  // editing for the rest of the document.
  test("pairs a malformed QName that XMLname rejects", () => {
    const text = "<a:b:c>x</a:b:c>";
    const pair = findTagPair(text, 2);
    assert.ok(pair);
    assert.strictEqual(pair[0].name, "a:b:c");
    assert.ok(!XMLname.test("a:b:c"));
  });
});
