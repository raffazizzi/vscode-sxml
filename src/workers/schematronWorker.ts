import { parentPort, workerData } from 'worker_threads';
import { runSchematronJob } from "./schematronCore";

runSchematronJob(workerData).then((result) => parentPort?.postMessage(result));
