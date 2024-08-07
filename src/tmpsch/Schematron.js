import SaxonJS from "saxon-js";
import { existsSync as exists } from "node:fs";
import fs from "node:fs/promises";
import { URL } from "url";
import { exec } from "node:child_process";
import { default as Stylesheets } from "./stylesheets/index.js";

export default class Schematron {
  constructor(opts = {}) {
    // Whether to create the SEF JSON file using exec
    this.useExec = opts.useExec || false;
  }

  /**
   * Main method for validation
   * @param {string} xml
   * @returns { Array } Array of results
   */
  async validate(xml) {
    if (this.useExec) {
      return await this._validateWithSVRLSEF(xml);
    }
    return await this._validateWithRunner(xml);
  }

  /**
   * Set the schematron text for use of validation
   * (only one of setSchematron or setRNG should be used)
   *
   * Chainable
   * @param {string} schText
   * @returns { Validator } The schematron
   */
  async setSchematron(schText) {
    this.schematron = schText;
    await this._setSVRL(schText);
    return this;
  }

  /**
   * Set the RNG string from which to extract the schematron
   *
   * Chainable
   * @param {string} rngText
   * @returns
   */
  async setRNG(rngText) {
    const sch = await this._extractSchFromRNG(rngText);
    await this.setSchematron(sch);
    return this;
  }

  /**
   * Create the SVRL output from the Schematron
   * @param {*} schText
   * @returns
   */
  async _setSVRL(schText) {
    const svrl = await this._transformSchToSVRL(schText);
    this.svrl = this.useExec ? await this._transformSVRLtoSEF(svrl) : svrl;
    return this;
  }

  /**
   * Validates by running the source XML through the SVRL.sef,
   * and then running those results through to make an array
   * @param {*} xml
   * @returns
   */
  async _validateWithSVRLSEF(xml) {
    const { principalResult: svrlResults } = await SaxonJS.transform({
      stylesheetText: this.svrl,
      sourceText: xml,
      destination: "serialized",
    });
    const { principalResult: resultsArray } = await SaxonJS.transform({
      stylesheetText: Stylesheets.results.toString(),
      sourceText: svrlResults,
      destination: "raw",
      resultForm: "array",
    });
    return resultsArray;
  }

  /**
   * Validates by running the stylesheet through an internal transformation,
   * which then runs those results through to make an array
   *
   * @param {*} xml
   * @returns
   */
  async _validateWithRunner(xml) {
    const opts = {
      initialTemplate: "go",
      destination: "raw",
      resultForm: "array",
      stylesheetParams: {
        sourceText: xml,
        stylesheetText: this.svrl,
      },
    };
    if (!this.stylesheetInternal) {
      opts["stylesheetText"] = Stylesheets.runner.toString();
    } else {
      opts["stylesheetInternal"] = this.stylesheetInternal;
    }
    const { principalResult, stylesheetInternal } = await SaxonJS.transform(
      opts
    );
    if (!this.stylesheetInteral) {
      this.stylesheetInteral = stylesheetInternal;
    }
    return principalResult;
  }

  /**
   * Creates the SVRL from the schematron (using David Maus' SVRL pipeline)
   * @param {string} schText
   * @returns
   */
  async _transformSchToSVRL(schText) {
    const { principalResult } = await SaxonJS.transform({
      stylesheetText: Stylesheets.svrlPipeline.toString(),
      sourceText: schText,
      destination: "serialized",
    });
    return principalResult;
  }

  /**
   * Transforms the SVRL to an SEF file; this makes the
   * validation process *significantly* (100x or so) faster,
   * but requires shelling out to a child process
   * and writing a temporary directory
   * @param {*} svrl
   * @returns
   */
  async _transformSVRLtoSEF(svrl) {
    const tmpDir = new URL("./_tmp/", import.meta.url).pathname;
    if (!exists(tmpDir)) {
      await fs.mkdir(tmpDir);
    }
    await fs.writeFile(`${tmpDir}svrl.xsl`, svrl);
    exec("xslt3", [
      `-xsl:${tmpDir}/svrl.xsl`,
      `-export:${tmpDir}/svrl.sef.json`,
      "-nogo",
    ]);
    const sef = await fs.readFile(`${tmpDir}/svrl.sef.json`, "utf-8");
    return sef;
  }

  /**
   * Extracts the Schematron from the RNG
   * @param {string} rngText
   * @returns
   */
  async _extractSchFromRNG(rngText) {
    if (this.schematron) {
      return this.schematron;
    }
    const { principalResult } = await SaxonJS.transform(
      {
        stylesheetText: Stylesheets.extractFromRng.toString(),
        sourceText: rngText,
        destination: "serialized",
      },
      "async"
    );
    return principalResult;
  }
}
