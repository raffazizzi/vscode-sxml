import * as assert from "assert";
import { truncate, parseXPath, matchPath } from "../utils";

suite("utils.ts", () => {

  suite("truncate", () => {
    test("shorter than limit → unchanged", () => {
      assert.strictEqual(truncate("hello", 10), "hello");
    });
    test("exactly at limit → unchanged", () => {
      assert.strictEqual(truncate("hello", 5), "hello");
    });
    test("longer than limit → ellipsis", () => {
      assert.strictEqual(truncate("hello world", 6), "hello…");
    });
    test("empty string → empty string", () => {
      assert.strictEqual(truncate("", 5), "");
    });
  });

  suite("parseXPath", () => {
    test("single step with namespace", () => {
      const steps = parseXPath("/Q{http://www.tei-c.org/ns/1.0}TEI[1]");
      assert.strictEqual(steps.length, 1);
      assert.strictEqual(steps[0].name.namespace, "http://www.tei-c.org/ns/1.0");
      assert.strictEqual(steps[0].name.local, "TEI");
      assert.strictEqual(steps[0].index, 1);
    });
    test("attribute step uses @", () => {
      const steps = parseXPath("/Q{}root[1]/@Q{}id");
      assert.strictEqual(steps[1].isAttribute, true);
      assert.strictEqual(steps[1].name.local, "id");
      assert.strictEqual(steps[1].index, undefined);
    });
    test("nested steps", () => {
      const steps = parseXPath("/Q{http://www.tei-c.org/ns/1.0}TEI[1]/Q{http://www.tei-c.org/ns/1.0}text[1]");
      assert.strictEqual(steps.length, 2);
      assert.strictEqual(steps[1].name.local, "text");
    });
    test("missing leading slash throws", () => {
      assert.throws(() => parseXPath("Q{}root"), /Expected '\/'/);
    });
    test("missing Q{ throws", () => {
      assert.throws(() => parseXPath("/root"), /Expected 'Q{'/);
    });
    test("unterminated namespace throws", () => {
      assert.throws(() => parseXPath("/Q{http://example.com"), /Unterminated namespace/);
    });
  });

  suite("matchPath", () => {
    test("matching path returns true", () => {
      const path = [{ ns: "http://www.tei-c.org/ns/1.0", local: "TEI", index: 1 }];
      const steps = parseXPath("/Q{http://www.tei-c.org/ns/1.0}TEI[1]");
      assert.ok(matchPath(path, steps));
    });
    test("wrong local name → false", () => {
      const path = [{ ns: "http://www.tei-c.org/ns/1.0", local: "body", index: 1 }];
      const steps = parseXPath("/Q{http://www.tei-c.org/ns/1.0}TEI[1]");
      assert.ok(!matchPath(path, steps));
    });
    test("wrong index → false", () => {
      const path = [{ ns: "http://www.tei-c.org/ns/1.0", local: "TEI", index: 2 }];
      const steps = parseXPath("/Q{http://www.tei-c.org/ns/1.0}TEI[1]");
      assert.ok(!matchPath(path, steps));
    });
    test("different lengths → false", () => {
      const path = [
        { ns: "", local: "root", index: 1 },
        { ns: "", local: "child", index: 1 }
      ];
      const steps = parseXPath("/Q{}root[1]");
      assert.ok(!matchPath(path, steps));
    });
  });
});