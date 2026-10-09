import * as assert from "assert";
import { findTagPair } from "../services/autorename";

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
