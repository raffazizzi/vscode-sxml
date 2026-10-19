import { Uri } from "vscode";
import { join } from "path";
import { runSchematronJob } from "../workers/schematronCore";
import type { SchematronJob, SchematronRunResult } from "../workers/schematronCore";

export type { SchematronRunResult } from "../workers/schematronCore";

export interface SchematronRunOptions extends SchematronJob {
  signal: AbortSignal;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __non_webpack_require__: any;

let extensionUri: Uri | undefined;
let webWorkerUrl: Promise<string | undefined> | undefined;

export function initSchematronRunner(uri: Uri) {
  extensionUri = uri;
}

const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

export async function runSchematron(options: SchematronRunOptions): Promise<SchematronRunResult> {
  if (options.signal.aborted) {
    return {};
  }
  const { signal, ...job } = options;

  if (isNode) {
    const { Worker } = __non_webpack_require__("worker_threads");
    const worker = new Worker(join(__dirname, "./schematronWorker.js"), { workerData: job });
    return awaitWorker(worker, signal, (onMessage, onError) => {
      worker.on("message", onMessage);
      worker.on("error", onError);
    });
  }

  const url = await getWebWorkerUrl();
  let worker: Worker | undefined;
  try {
    worker = url ? new Worker(url) : undefined;
  } catch (err) {
    console.error("Could not start the Schematron web worker.", err);
  }
  if (worker) {
    const w = worker;
    const result = awaitWorker(w, signal, (onMessage, onError) => {
      w.onmessage = (e) => onMessage(e.data);
      w.onerror = (e) => {
        e.preventDefault();
        onError(new Error(e.message));
      };
    });
    w.postMessage(job);
    return result;
  }

  // No worker available: run in the extension host itself (blocks it while running).
  return runSchematronJob(job);
}

function awaitWorker(
  worker: { terminate: () => unknown },
  signal: AbortSignal,
  listen: (onMessage: (r: SchematronRunResult) => void, onError: (err: Error) => void) => void
): Promise<SchematronRunResult> {
  return new Promise((resolve) => {
    const finish = (result: SchematronRunResult) => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(result);
    };
    const onAbort = () => finish({});
    signal.addEventListener("abort", onAbort);
    listen(finish, (err) => finish({ error: err.message, errorName: err.name }));
  });
}

// Extension files are served from another origin than the extension host, and
// workers must be same-origin, so load the bundle once and start workers from a blob URL.
function getWebWorkerUrl(): Promise<string | undefined> {
  if (!webWorkerUrl) {
    webWorkerUrl = (async () => {
      if (typeof Worker === "undefined" || !extensionUri) {
        return undefined;
      }
      try {
        const scriptUri = Uri.joinPath(extensionUri, "dist", "web", "schematronWorker.js");
        const response = await fetch(scriptUri.toString(true));
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const blob = new Blob([await response.text()], { type: "text/javascript" });
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error("Could not load the Schematron web worker; validating in the extension host instead.", err);
        return undefined;
      }
    })();
  }
  return webWorkerUrl;
}
