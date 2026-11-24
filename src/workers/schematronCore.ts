import Schematron from "node-xsl-schematron";

export interface SchematronJob {
  xmlSource: string;
  schematronSource: string;
  embedded: boolean;
}

export interface SchematronRunResult {
  errors?: Array<{ location: string; text: string }>;
  error?: string;
  errorName?: string;
}

// Shared by the Node worker, the web worker and the in-process fallback.
export async function runSchematronJob(job: SchematronJob): Promise<SchematronRunResult> {
  try {
    const sch = new Schematron();
    if (job.embedded) {
      await sch.setRNG(job.schematronSource);
    } else {
      await sch.setSchematron(job.schematronSource);
    }
    const errors = await sch.validate(job.xmlSource);
    return { errors };
  } catch (_error) {
    const error = _error as Error;
    return { error: error.message, errorName: error.name };
  }
}
