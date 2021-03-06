# Scholarly XML

Scholarly XML is a VSCode extension with a RELAX NG validator and autocomplete with features typically needed by academic encoding projects.

Unlike most XML VSCode extensions, Scholarly XML _does not require Java_. The extension builds on a fork of [Salve](https://github.com/mangalam-research/salve), a TypeScript RELAX NG implementation. This makes Scholarly XML easy to install for use with students, in workshops, and in minimal computing projects.

## Features

* Checks if XML is well-formed.
* Validates XML with associated RELAX NG schema (via `<?xml-model?>`) when you open or modify a file.
* Makes schema aware suggestions for elements, attributes, and attribute values.
* When available, shows documentation from schema for elements, attributes, and attribute values.
* Wrap selected text with tags using Ctrl+e

## Usage

### Validation

To validate, your XML file needs to be associated to a RELAX NG schema via `<?xml-model?>`. For example:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?xml-model
  href="https://vault.tei-c.org/P5/current/xml/tei/custom/schema/relaxng/tei_all.rng"
  schematypens="http://relaxng.org/ns/structure/1.0"
  type="application/xml"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" />
```

Validation will trigger automatically when you open an XML file and when you make changes. Or you can trigger it manually like this:

* Bring up the Command Palette (F1, or Ctrl+Shift+P on Windows and Linux, or Shift+CMD+P on OSX)
* Type or select "Scholarly XML: Validate XML with associated RELAX NG schema."

Validation continues as you type and the result is shown in the status bar at the bottom.

![Demo showing validation on typing](https://github.com/raffazizzi/vscode-sxml/raw/main/images/rm-validate.gif)

### Suggestions and documentation

Schema-aware suggestions will be made as you type elements, attributes, and attribute values. You can also bring them up like all other suggestions using Ctrl+Space.

If it's available in the schema, documentation will be shown.

![Demo showing schema-aware suggestions](https://github.com/raffazizzi/vscode-sxml/raw/main/images/rm-suggestions.gif)

### Wrap selection with element

Select some text and wrap it in a tag using Ctrl+e or by bringing up the Command Palette and typing "Scholarly XML: Wrap selection with element".

![Demo showing wrapping text with element](https://github.com/raffazizzi/vscode-sxml/raw/main/images/rm-wrap.gif)

## Recommended extensions

For a better XML editing experience we recommend also installing the following extensions:

* [Auto Close Tag](https://marketplace.visualstudio.com/items?itemName=formulahendry.auto-close-tag)
* [Auto Rename Tag](https://marketplace.visualstudio.com/items?itemName=formulahendry.auto-rename-tag)
* [Close HTML/XML tag](https://marketplace.visualstudio.com/items?itemName=Compulim.compulim-vscode-closetag)

## Change log

You can read the change log [here](https://github.com/raffazizzi/vscode-sxml/blob/master/CHANGELOG.md).

## Contributions

Like this extension? [Star it on GitHub](https://github.com/raffazizzi/vscode-sxml/stargazers)!

Do you have an idea or suggestion? [Open a feature request](https://github.com/raffazizzi/vscode-sxml/issues).

Found something wrong? [File an issue](https://github.com/raffazizzi/vscode-sxml/issues).
