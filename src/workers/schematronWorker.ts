import { parentPort, workerData } from 'worker_threads';
import Schematron from "node-xsl-schematron";

async function runValidation() {
  try {
    const { xmlSource, schematronSource, embedded } = workerData;
    const sch = new Schematron();
    if (embedded) {
      await sch.setRNG(schematronSource)
    } else {
      await sch.setSchematron(schematronSource)
    }
    const errors = await sch.validate(xmlSource);
    parentPort?.postMessage({ errors });
  } catch (_error) {
    const error = _error as Error
    parentPort?.postMessage({ error: error.message, errorName: error.name });
  }
}

runValidation();