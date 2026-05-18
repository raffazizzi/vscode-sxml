import { normalizeSchemaUrl } from "../utils";
import { Uri, window, workspace } from "vscode";

import type { StoredSchematron } from "../types";
import type { TextDocument } from "vscode";

export function locateSchema(document: TextDocument): string | undefined {
  const fileText = document.getText();
  const extKey = document.fileName.split(".").pop()!;
  const defaultSchemas = workspace.getConfiguration("sxml").get("defaultSchemas") as { [key: string]: string };

  let schemaURL = defaultSchemas?.[extKey];

  const schemaURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0"/s)
    ?? fileText.match(/<\?xml-model.+?schematypens="http:\/\/relaxng.org\/ns\/structure\/1.0".+?href="([^"]+)"/s);

  if (schemaURLMatch) schemaURL = schemaURLMatch[1];
//this function gets the full text of xml file, then searches for the model and href in it. 
//if it finds it returns otherwise it returns undefined. 
//adding a check between that checks did we find the model line? if yes but no href warn the user
const hasXmlModel = fileText.match(/<\?xml-model/);
if (hasXmlModel && !schemaURLMatch) {
  console.log("Found xml-model but no href!");
  window.showInformationMessage("Schema not associated correctly — make sure you're using href= in your <?xml-model?>");
}
  if (!schemaURL) return undefined;

  const schema = schemaURL && normalizeSchemaUrl(schemaURL);

  return schema;
}

export async function locateSchematron(document: TextDocument, rngURI?: string): Promise<void | StoredSchematron> {
  const fileText = document.getText();

  let schematronURL: string | undefined;

  const schematronURLMatch = fileText.match(/<\?xml-model.*?href="([^"]+)".+?schematypens="http:\/\/purl.oclc.org\/dsdl\/schematron"/s)
    ?? fileText.match(/<\?xml-model.+?schematypens="http:\/\/purl.oclc.org\/dsdl\/schematron".+?href="([^"]+)"/s);

  if (schematronURLMatch) schematronURL = schematronURLMatch[1];

  if (!schematronURL) return Promise.resolve();

  let uri = schematronURL && normalizeSchemaUrl(schematronURL);

  // Determine if schematron is embedded, otherwise fetch it and return its contents.
  let rawText: undefined | string;
  let embedded = false;
  if (uri && rngURI && uri === rngURI) {
    embedded = true;
  } else if (uri) {
    try {
      if (uri.startsWith("http")) {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Failed to fetch ${uri}: ${response.statusText}`);
        rawText = await response.text();
      } else {
        const doc = await workspace.openTextDocument(Uri.parse(uri));
        rawText = doc.getText();
      }
    } catch (err) {
      console.log(err);
      window.showInformationMessage("Could not fetch schematron from URL.");
    }
  }

  return { embedded, uri, rawText };
}
