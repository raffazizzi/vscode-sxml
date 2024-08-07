import extractFromRng from "./sef/ExtractSchFromRNG-2.sef.json" assert { type: "json" };
import svrlPipeline from "./sef/pipeline-for-svrl.sef.json" assert { type: "json" };
import runner from "./sef/runner.sef.json" assert { type: "json" };
import results from "./sef/results.sef.json" assert { type: "json" };

class Stylesheet {
  constructor(sef) {
    this.sef = sef;
  }

  toJSON() {
    return this.sef;
  }

  toString() {
    return JSON.stringify(this.sef);
  }
}

export default {
  extractFromRng: new Stylesheet(extractFromRng),
  svrlPipeline: new Stylesheet(svrlPipeline),
  runner: new Stylesheet(runner),
  results: new Stylesheet(results),
};
