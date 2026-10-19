import * as assert from "assert";
import { formatXML } from "../services/format";

const doc = `<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body>
      <p>a</p>
    </body>
  </text>
</TEI>`;

suite("formatXML", () => {
  test("formats a document without trailing whitespace", () => {
    assert.ok(formatXML(doc).endsWith("</TEI>"));
  });

  test("returns and keeps the final newline", () => {
    const out = formatXML(doc + "\n");
    assert.ok(out.endsWith("</TEI>\n"));
    assert.strictEqual(formatXML(out), out);
  });

  test("keeps other trailing whitespace as it was", () => {
    assert.ok(formatXML(doc + "\r\n").endsWith("</TEI>\r\n"));
    assert.ok(formatXML(doc + " \n\n").endsWith("</TEI> \n\n"));
  });
});
