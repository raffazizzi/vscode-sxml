import 'cross-fetch/polyfill';
import * as vscode from 'vscode';
import {DefaultNameResolver, EnterStartTagEvent} from 'salve-annos';
import { StoredGrammar, GrammarStore, grammarFromSource, locateSchema } from './extension';
import { SaxesParser, SaxesTag, SaxesAttributeNS, SaxesStartTagNS } from "saxes";
import { Ref, Grammar } from 'salve-annos/lib/salve/patterns';

// Constants
const TAG = 'TAG';
const ATT = 'ATT';
const VAL = 'VAL';

class SalveCompletionProvider implements vscode.CompletionItemProvider {
  store: GrammarStore;
  constructor(store: GrammarStore) {
    this.store = store;
  }
  public provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.CompletionContext):
    Thenable<vscode.CompletionItem[]> {
      const line = document.lineAt(position.line).text;
      const lineUntil = line.substring(0, position.character);
      const offset = document.offsetAt(position);
      const textUntil = document.getText().substring(0, offset);

      let request = TAG;

      if (context.triggerCharacter === ' ') {
        if (textUntil.match(/<[^>]+$/)) {
          request = ATT;
        } else {
          // abort
          return new Promise(() => {});
        }
      } else if (context.triggerCharacter === '"') {
        if (lineUntil.match(/="$/)) {
          request = VAL;
        } else {
          // abort
          return new Promise(() => {});
        }
      } else if (context.triggerKind === 0) {
        if (lineUntil.match(/="\s*$/)) {
          request = VAL;
        } else if (textUntil.match(/<[^>]+$/)) {
          request = ATT;
        } else {
          // abort
          return new Promise(() => {});
        }
      }
      
      const schemaData = locateSchema();
      if (schemaData) {
        const {schema, fileText, xmlURI} = schemaData;
        const _xmlURI = xmlURI.toString();
        let storedGrammar: StoredGrammar;
        if (!this.store[_xmlURI]) {
          // Don't attempt to perform completions before validation.
          return new Promise(() => {});
        } else {
          storedGrammar = this.store[_xmlURI];
        }
        return getCompletions(storedGrammar, schema, fileText, position, offset, request);
      } else {
        return new Promise(() => {});
      }
  }
}

function truncate(str: string, n: number){
  return (str.length > n) ? str.substr(0, n-1) + '…' : str;
}

async function getCompletions(storedGrammar: StoredGrammar, rngSource: string, xmlSource: string,
  position: vscode.Position, offset: number, request: string):
  Promise<Array<vscode.CompletionItem>> {
  let tree: Grammar;
  if (storedGrammar) {
    tree = storedGrammar.grammar as Grammar;
  } else {
    tree = await grammarFromSource(rngSource) as Grammar;
  }
  if (!tree) {
    return [];
  }
  const nameResolver = new DefaultNameResolver();
  const walker = tree.newWalker(nameResolver);

  const parser = new SaxesParser({ xmlns: true, position: true });

  function fireEvent(name: string, args: any[]): void {
		walker.fireEvent(name, args);
  }

  const items: Array<vscode.CompletionItem> = [];
  const elementStack: Array<SaxesTag> = [];
  let sawRoot: Boolean = false;

  const showElementSuggestion = (node: SaxesTag) => {
    if (!node && !sawRoot) {
      // Suggest valid start elements
      const start = <Ref> tree.start;
      const startEl = start.element.name.toJSON().name;
      items.push(
        new vscode.CompletionItem(startEl, 24)
      );
    } else {
      // TODO: Occasionally we get duplicated here from possible(). Why?
      // For now, weed out dupes.
      const possibilities = Array.from(walker.possible());
      const els: EnterStartTagEvent[] = [];
      for (const entry of possibilities) {
        if (entry.name === 'enterStartTag') {
          const name = entry.namePattern.toJSON().name;
          const ns = entry.namePattern.toJSON().ns;
          const dupes = els.filter(e => {
            return e.namePattern.toJSON().name === name && e.namePattern.toJSON().ns === ns;
          });
          if (dupes.length === 0) {
            els.push(entry);
          }          
        }
      }
      els.forEach(entry => {
        if (entry.name === 'enterStartTag') {
          const tag = entry.namePattern.toJSON();
          let prefix = '';
          let xmlns = '';
          let diffNs = '';
          if (tag.ns) {
            const ns = nsDefinitions.filter(ns => ns.value === tag.ns)[0];            
            if (ns) {
              // Only show ns if different from parent.
              if (tag.ns !== node.uri) {
                diffNs = ` ${tag.ns}`;
                prefix = `${ns.prefix}:`;
              }
            } else {
              nsDefinitions.push({
                prefix: '', 
                value: tag.ns,
                generated: true});
              diffNs = ` ${tag.ns}`;
              xmlns = ` xmlns="${tag.ns}"`;
            }
          }
          const ci = new vscode.CompletionItem(`${prefix}${tag.name}${diffNs}`, 24);
          ci.insertText = `${prefix}${tag.name}${xmlns}></${prefix}${tag.name}>`;
          ci.detail = truncate(tag.documentation, 20);
          ci.documentation = tag.documentation;
          ci.command = {
            arguments: [0, -(`${prefix}${tag.name}`.length + 3)],
            command: 'sxml.translateCursor',
            title: 'Place cursor between tags',
          };
          items.push(ci);
        }
      });
    }    
  };

  const showAttSuggestion = (excluded: Record<string, SaxesAttributeNS> | Record<string, string>) => {
    const possibilities = walker.possible().entries();
    for (const entry of possibilities) {
      if (entry[0].name === 'attributeName') {
        const att = entry[0].namePattern.toJSON();
        if (Object.keys(excluded).filter(e => e === att.name).length === 0) {
          let prefix = '';
          let newNs = '';
          let xmlns = '';
          if (att.ns) {
            const ns = nsDefinitions.filter(ns => ns.value === att.ns)[0];
            if (ns) {
              if (ns.generated) {
                xmlns = `xmlns:${ns.prefix}="${att.ns}" `;
                prefix = `${ns.prefix}:`;
                newNs = ` ${att.ns}`;
              } else {
                prefix = `${ns.prefix}:`;
              }
            } else if (att.ns === "http://www.w3.org/XML/1998/namespace") {
              prefix = `xml:`;
            } else {
              nsDefinitions.push({
                prefix: `ns${nsCount}`, 
                value: att.ns,
                generated: true});
              xmlns = `xmlns:ns${nsCount}="${att.ns}" `;
              prefix = `ns${nsCount}:`;
              newNs = ` ${att.ns}`;
              nsCount++;
            }
          }
          const ci = new vscode.CompletionItem(`$(mention)${prefix}${att.name}${newNs}`, 24);
          ci.filterText = `${prefix}${att.name}`;
          ci.insertText = `${xmlns}${prefix}${att.name}=""`;
          ci.detail = truncate(att.documentation, 20);
          ci.documentation = att.documentation;
          ci.command = {command: 'sxml.suggestAttValue', title: 'Suggest Attribute Value'};
          items.push(ci);
        }
      }
    }
  };

  const showValSuggestion = () => {
    const possibilities = walker.possible().entries();
    for (const entry of possibilities) {
      if (entry[0].name === 'attributeValue') {
        const attValue = entry[0];
        // Exclude RNG-derived regex patterns
        if (attValue.value instanceof RegExp) {
          continue;
        }
        const ci = new vscode.CompletionItem(attValue.value.toString(), 24);
        ci.documentation = attValue.documentation;
        items.push(ci);
      }
    }
  };

  // Set attribute stacks to facilitate attribute value suggestions.
  let attPos = 0;
  const attStack: SaxesAttributeNS[] = [];  
  let tagFound = false;

  // Keep track of namespaces
  // TODO: this should probably be done just once,
  // not at every suggestion. But how?
  type NSDef = {
    prefix: string;
    value: string;
    generated: boolean;
  };

  const nsDefinitions: NSDef[] = [];
  let nsCount = 1;

  try {
    // NB: handlers are listed in processing order

    parser.on('opentagstart', (node: SaxesStartTagNS) => {
      // Reset attribute stacks
      attPos = 0;
      attStack.length = 0;
      if (request !== TAG) {
        tagFound = false;
        // If there is no > between the cursor offset and the parser's
        // then we have entered the element
        if (!xmlSource.substring(parser.position, offset).includes('>')) {
          tagFound = true;
        }
      }
    });

    parser.on('attribute', (att: SaxesAttributeNS) => {
      if (request !== TAG && tagFound) {
        // Keep track of attributes before current offset 
        // so that opentag can fire the right one after
        // enterStartTag has all the data it needs
        switch (request) {
          case ATT:
            attPos = offset;
            attStack.push(att);
            break;
          case VAL:            
            if (offset >= parser.position - 1) {
              attPos = offset;
              attStack.push(att);
            }
            break;
          default:
            // no-op
        }
      }
    });

    parser.on('opentag', (node: SaxesTag) => {
      // store namespaces
      const names = Object.keys(node.attributes);
      names.sort();
      for (const name of names) {
        const attr = node.attributes[name] as SaxesAttributeNS;
        if (name === "xmlns") { // xmlns="..."
          nsDefinitions.push({
            prefix: "", 
            value: attr.value,
            generated: false});
        }
        else if (attr.prefix === "xmlns") { // xmlns:...=...
          nsDefinitions.push({
            prefix: attr.local, 
            value: attr.value,
            generated: false});
        }
      }

      fireEvent("enterStartTag", [node.uri, node.local]);
      let left = false;
      if (offset === attPos
        || offset === parser.position - 2 || offset === parser.position - 1
        || offset === parser.position + 1) {
        switch (request) {
          case ATT:
            showAttSuggestion(node.attributes);
            break;
          case VAL:
            // fire last attribute before cursor
            // (that is the one for which the value is being suggested)
            if (offset === attPos) {
              // we need to rely on the stack
              const att: SaxesAttributeNS = attStack[attStack.length - 1];
              if (att) {
                fireEvent("attributeName", [att.uri, att.name]);
              }
              showValSuggestion();
            } else if (offset === parser.position - 2) {
              // there were no previous attributes, so we can't rely on the stack.
              // -2 makes up for equal sign and first quote already consumed
              const atts = Object.entries(node.attributes);
              const att = atts[atts.length - 1];
              if (att) {
                fireEvent("attributeName", [att[1].uri, att[1].name]);
              }
              showValSuggestion();
            }            
            break;
          case TAG:
            if (offset === parser.position + 1) {
              fireEvent("leaveStartTag", []);
              left = true;
              showElementSuggestion(node);
            }
            break;
          default:
            // no-op; 
        }
      }
      if (!left) {
        fireEvent("leaveStartTag", []);
      }
      if (!sawRoot) {
        sawRoot = true;
      }
      elementStack.push(node);
    });
    
    parser.on('closetag', () => {
      const tagInfo = elementStack.pop();
      if (tagInfo === undefined) {
        throw new Error("stack underflow");
      }
      fireEvent("endTag", [tagInfo.uri, tagInfo.local]);
      if (position.line === parser.line - 1 && offset - 1 === parser.position) {
        if (request === TAG) {
          showElementSuggestion(elementStack.slice(-1)[0]);
        }
      }
    });

    parser.on('text', (text: String) => {
      if (request === TAG) {
        if (position.line === parser.line - 1 && offset === parser.position) {
          showElementSuggestion(elementStack.slice(-1)[0]);
        }
      }
    });
  
    parser.write(xmlSource).close();
  } catch(err) {
    // Ignore sax errors because we expect the file to not be well formed at this stage.
  } 
  
  return items;
}

export default SalveCompletionProvider;