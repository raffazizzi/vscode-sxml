import Schematron from 'node-xsl-schematron';
import type { Grammar } from "salve-annos";
import type { Diagnostic } from 'vscode';

export interface StoredGrammar {
  uri?: string;
  grammar?: Grammar | void;
  rawText?: string;
}

export interface StoredSchematron {
  uri?: string;
  schematron?: typeof Schematron | null;
  rawText?: string
  embedded?: boolean
}

export interface GrammarStore {
  [key: string]: StoredGrammar;
}

// XPath notation returned by node-xsl-schematron is in Clark notation.
export type ClarkName = { namespace: string; local: string };

export type XPathStep = {
  name: ClarkName;
  index?: number;
  isAttribute?: boolean;
};

export type NodePath = { ns: string; local: string; index: number };

export type TagInfo = {
  uri: string;
  local: string;
  hasContext: boolean;
  name?: string;
  line?: number;
  column?: number;
};

export interface XIncludeLocation {
  uri: string;
  line: number;
  column: number;
  parentUri: string;
}

export type ValidationResult = {
  errorType: string,
  errorCount: number,
  diagnostics: Diagnostic[]
}

export type NSDef = {
  prefix: string;
  value: string;
  generated: boolean;
};