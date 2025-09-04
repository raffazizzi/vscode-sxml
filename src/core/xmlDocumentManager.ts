import { locateSchema, locateSchematron } from "../services/locate";
import { resolveXIncludes } from "../services/xinclude";
import { convertRNGToPattern, DefaultNameResolver } from "salve-annos";
import { SaxesParser } from "saxes";
import { window } from "vscode";

import type { StoredGrammar, StoredSchematron } from "../types";
import type { Grammar } from "salve-annos";
import type { TextDocument, Uri } from "vscode";

export class XMLDocumentManager {
  private document?: TextDocument;
  private storedGrammar: StoredGrammar = {};
  private storedSchematron: StoredSchematron = {};
  public documentText: string = "";
  public uri?: Uri;
  public parser?: SaxesParser;
  public nameResolver?: DefaultNameResolver;

  private async setFullDocumentText() {
    // resolve XIncludes (NB the function checks settings to decide whether to actually resolve or not).
    if (this.document) {
      this.documentText = await resolveXIncludes(this.document.getText());
    }
  }

  private async grammarFromSource(rngSource: string): Promise<[Grammar, string] | void> {
    const schemaURL = new URL(rngSource);
    try {
      const s = await convertRNGToPattern(schemaURL);
      return [s.pattern, s.schemaText]
    } catch(err) {
      console.log(err);
      window.showInformationMessage("Could not parse RelaxNG schema.");
    }
  }

  public async getGrammar(): Promise<Grammar | void> {
    // Call this method at instantiation and on document change.

    if (!this.document) return;

    const rngURI = locateSchema(this.document);
    
    if (rngURI) {
      // Re-compile grammar only if the schema URI has changed
      // TODO: also re-compile grammar if grammar contents has changed.
      if (!this.storedGrammar.grammar || this.storedGrammar.uri !== rngURI) {
        console.log(`Schema changed or new. Compiling grammar for ${rngURI}`);
        this.storedGrammar.uri = rngURI;
        const [grammar, rawText] = await this.grammarFromSource(rngURI) ?? [];
        this.storedGrammar.grammar = grammar;
        this.storedGrammar.rawText = rawText;
      }
      return this.storedGrammar.grammar;
      
    } else {
      this.storedGrammar = {};
      return;
    }
  }

  public getCachedGrammar(): Grammar | void {
    return this.storedGrammar.grammar;
  }

  public async getSchematron(): Promise<StoredSchematron | void> {
    // Call this method at instantiation and on document change.

    if (!this.document) return;

    const schInfo = await locateSchematron(this.document, this.storedGrammar?.uri);
    
    if (schInfo) {
      // Re-load schematron only if the schematron URI has changed.
      // TODO: also re-load if schematron (or grammar, when embedded) has changed.
      if (this.storedSchematron.uri) {
        if (schInfo.uri === this.storedSchematron.uri) {
          // return cached schematron.
          return this.storedSchematron;
        }
      } else {
        this.storedSchematron = {
          uri: schInfo.uri,
        };
      }
      // store new schematron data
      // NB schematron is handled through a worker so we only cache data.
      if (schInfo.embedded) {
        this.storedSchematron.rawText = this.storedGrammar.rawText;
        this.storedSchematron.embedded = true;
      } else {
        this.storedSchematron.rawText = schInfo.rawText;
        this.storedSchematron.embedded = false;
      }
      return this.storedSchematron;
    } else {
      // cleanup if no schematron
      this.storedSchematron = {};
      return;
    }
  }

  public async updateDocument(document: TextDocument): Promise<void> {
    this.document = document;
    this.uri = document.uri;

    this.parser = new SaxesParser({ xmlns: true, position: true });
    this.nameResolver = new DefaultNameResolver();
    
    await this.setFullDocumentText();
    await this.getGrammar();
    await this.getSchematron();
  }

}
