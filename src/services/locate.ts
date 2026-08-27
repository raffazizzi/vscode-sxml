import { normalizeSchemaUrl } from "../utils";
import { RELAXNG_NS, SCHEMATRON_NS } from "../constants";
import { Uri, window, workspace } from "vscode";

import type { StoredSchematron, XmlModelPI } from "../types";
import type { TextDocument } from "vscode";

const XML_MODEL_PI = /<\?xml-model\s[\s\S]*?\?>/g;

// Read one pseudo-attribute out of a single PI. Values may be quoted either way
function pseudoAtt(pi: string, name: string): string | undefined {
  const match = pi.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return match ? (match[2] ?? match[3]) : undefined;
}

// Parses every <?xml-model?> PI in the document into its pseudo-attributes
export function parseXmlModelPIs(fileText: string): XmlModelPI[] {
  return (fileText.match(XML_MODEL_PI) ?? []).map((pi) => ({
    href: pseudoAtt(pi, "href"),
    schematypens: pseudoAtt(pi, "schematypens"),
  }));
}

function findAssociation(fileText: string, schematypens: string): XmlModelPI | undefined {
  const pis = parseXmlModelPIs(fileText).filter((pi) => pi.schematypens === schematypens);
  return pis.find((pi) => pi.href) ?? pis[0];
}

export function locateSchema(document: TextDocument): string | undefined {
  const fileText = document.getText();
  const extKey = document.fileName.split(".").pop()!;
  const defaultSchemas = workspace.getConfiguration("sxml").get("defaultSchemas") as { [key: string]: string };

  let schemaURL = defaultSchemas?.[extKey];

  const association = findAssociation(fileText, RELAXNG_NS);

  if (association?.href) {
    schemaURL = association.href;
  } else if (association) {
    console.log("Found xml-model but no href!");
    window.showInformationMessage("Schema not associated correctly — make sure you're using href= in your <?xml-model?>");
  }

  if (!schemaURL) return undefined;

  const schema = schemaURL && normalizeSchemaUrl(schemaURL, document.uri.toString());

  return schema;
}

export async function locateSchematron(document: TextDocument, rngURI?: string): Promise<void | StoredSchematron> {
  const fileText = document.getText();

  const schematronURL = findAssociation(fileText, SCHEMATRON_NS)?.href;

  if (!schematronURL) return Promise.resolve();

  let uri = schematronURL && normalizeSchemaUrl(schematronURL, document.uri.toString());

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
