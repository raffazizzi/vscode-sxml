import { workspace, Uri } from "vscode";
import type { Resource, ResourceLoader } from "salve-annos";

export class VSCodeResourceLoader implements ResourceLoader {
  async load(path: URL): Promise<Resource> {
    const urlString = path.toString();
    return {
      url: path,
      getText: async () => {
        if (path.protocol === "http:" || path.protocol === "https:") {
          const response = await fetch(urlString);
          if (!response.ok) {
            throw new Error(`Failed to fetch schema from ${urlString}: ${response.statusText}`);
          }
          return await response.text();
        } else {
          const uri = Uri.parse(urlString);
          const uint8Array = await workspace.fs.readFile(uri);
          return new TextDecoder("utf-8").decode(uint8Array);
        }
      }
    };
  }
}

export function createResourceLoader(): ResourceLoader {
  return new VSCodeResourceLoader();
}
