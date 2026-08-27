import * as assert from "assert";
import * as vscode from "vscode";
import { locateSchema, locateSchematron, parseXmlModelPIs } from "../services/locate";
import { RELAXNG_NS, SCHEMATRON_NS } from "../constants";

function fakeDoc(content: string, fileName = "test.xml"): vscode.TextDocument {
  return {
    getText: () => content,
    fileName,
    uri: vscode.Uri.parse("file:///test.xml"),
  } as unknown as vscode.TextDocument;
}

// Two multi-line PIs pointing at different files: a RELAX NG grammar and a standalone Schematron.
const TWO_PIS_DIFFERENT = `<?xml version="1.0" encoding="utf-8"?>
<?xml-model
  href="test.rng"
  schematypens="${RELAXNG_NS}"
  type="application/xml"?>
<?xml-model
  href="other.sch"
  schematypens="${SCHEMATRON_NS}"
  type="application/xml"?>
<root/>`;

// Embedded-Schematron.
const TWO_PIS_SAME = `<?xml version="1.0" encoding="utf-8"?>
<?xml-model
  href="test.rng"
  schematypens="${RELAXNG_NS}"
  type="application/xml"?>
<?xml-model
  href="test.rng"
  schematypens="${SCHEMATRON_NS}"
  type="application/xml"?>
<root/>`;

suite("locate.ts", () => {

  suite("parseXmlModelPIs", () => {
    test("keeps each PI's href with its own schematypens", () => {
      const pis = parseXmlModelPIs(TWO_PIS_DIFFERENT);
      assert.strictEqual(pis.length, 2);
      assert.deepStrictEqual(pis[0], { href: "test.rng", schematypens: RELAXNG_NS });
      assert.deepStrictEqual(pis[1], { href: "other.sch", schematypens: SCHEMATRON_NS });
    });

    test("handles two PIs naming the same href", () => {
      const pis = parseXmlModelPIs(TWO_PIS_SAME);
      assert.strictEqual(pis.length, 2);
      assert.ok(pis.every((pi) => pi.href === "test.rng"));
      assert.strictEqual(pis[0].schematypens, RELAXNG_NS);
      assert.strictEqual(pis[1].schematypens, SCHEMATRON_NS);
    });

    test("accepts single-quoted values", () => {
      const pis = parseXmlModelPIs(`<?xml-model href='test.rng' schematypens='${RELAXNG_NS}'?>`);
      assert.deepStrictEqual(pis[0], { href: "test.rng", schematypens: RELAXNG_NS });
    });

    test("accepts whitespace around =", () => {
      const pis = parseXmlModelPIs(`<?xml-model href = "test.rng"  schematypens = "${RELAXNG_NS}" ?>`);
      assert.deepStrictEqual(pis[0], { href: "test.rng", schematypens: RELAXNG_NS });
    });

    test("reports a PI with no href", () => {
      const pis = parseXmlModelPIs(`<?xml-model schematypens="${RELAXNG_NS}"?>`);
      assert.strictEqual(pis.length, 1);
      assert.strictEqual(pis[0].href, undefined);
      assert.strictEqual(pis[0].schematypens, RELAXNG_NS);
    });

    test("returns nothing when there is no xml-model PI", () => {
      assert.deepStrictEqual(parseXmlModelPIs(`<?xml version="1.0"?><root/>`), []);
    });
  });

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

    test("reads a multi-line PI", () => {
      const result = locateSchema(fakeDoc(TWO_PIS_DIFFERENT));
      assert.ok(result!.endsWith("/test.rng"), `got ${result}`);
    });

    test("ignores the Schematron PI's href", () => {
      const result = locateSchema(fakeDoc(TWO_PIS_DIFFERENT));
      assert.ok(!result!.includes("other.sch"), `got ${result}`);
    });

    test("returns undefined for a Schematron-only document", () => {
      const doc = fakeDoc(
        `<?xml-model href="other.sch" schematypens="${SCHEMATRON_NS}"?><root/>`
      );
      assert.strictEqual(locateSchema(doc), undefined);
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

    test("reads a multi-line PI", async () => {
      const doc = fakeDoc(TWO_PIS_DIFFERENT);
      const result = await locateSchematron(doc, locateSchema(doc));
      assert.ok(result);
      assert.ok(result!.uri!.endsWith("/other.sch"), `got ${result!.uri}`);
    });

    test("standalone .sch alongside an RNG is not embedded", async () => {
      const doc = fakeDoc(TWO_PIS_DIFFERENT);
      const result = await locateSchematron(doc, locateSchema(doc));
      assert.ok(result);
      assert.strictEqual(result!.embedded, false);
    });

    test("same href in both PIs is embedded", async () => {
      const doc = fakeDoc(TWO_PIS_SAME);
      const result = await locateSchematron(doc, locateSchema(doc));
      assert.ok(result);
      assert.strictEqual(result!.embedded, true);
      assert.ok(result!.uri!.endsWith("/test.rng"), `got ${result!.uri}`);
    });
  });
});