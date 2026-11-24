import { runSchematronJob } from "./schematronCore";
import type { SchematronJob } from "./schematronCore";

// Dedicated web worker: receives one job, posts one result.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SchematronJob>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = async (e) => {
  ctx.postMessage(await runSchematronJob(e.data));
};
