import * as assert from "assert";
import { findMalformedEntity } from "../services/entities";

suite("Entity reference scanner", () => {
  for (const text of [
    "<root>&amp;&lt;&gt;&apos;&quot;</root>",
    "<root>&custom;&名;&a:b;</root>",
    "<root>&#123;&#xABCD;</root>",
    '<!DOCTYPE root [<!ENTITY custom "&amp;">]><root>&custom;</root>',
    "<!DOCTYPE root [<?test ] > &bad?><!-- ] > &bad -->]><root/>",
    '<root value="&amp; > text"/>',
    "<root><!-- &bad --> <![CDATA[&bad]]> <?test &bad?></root>",
    "<root><!-- unfinished &bad",
    "<root><![CDATA[unfinished &bad",
    "<?test unfinished &bad",
    '<!DOCTYPE root [<!ENTITY custom "unfinished &bad',
  ]) {
    test(`leaves valid references and non-entity contexts alone: ${text}`, () => {
      assert.strictEqual(findMalformedEntity(text), undefined);
    });
  }

  test("finds an error after comments, CDATA and processing instructions", () => {
    const text = "<root><!-- & --> <![CDATA[&]]> <?test &?> &bad text;</root>";
    assert.deepStrictEqual(findMalformedEntity(text), {
      start: text.indexOf("&bad"), end: text.indexOf("&bad") + 4
    });
  });

  test("does not treat a second ampersand as part of the first reference", () => {
    const text = "<root>&bad&amp;</root>";
    assert.deepStrictEqual(findMalformedEntity(text), { start: 6, end: 10 });
  });
});
