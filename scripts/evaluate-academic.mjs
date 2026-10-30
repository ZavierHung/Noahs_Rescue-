import { readFile, writeFile } from "node:fs/promises";
import { createAcademicRetriever } from "../server/src/academic/retriever.js";
import { evaluateRetrieval } from "../server/src/academic/evaluation.js";
const cases = JSON.parse(
  await readFile(
    new URL("../server/data/academic/evaluation-cases.json", import.meta.url),
    "utf8",
  ),
);
const report = evaluateRetrieval(await createAcademicRetriever(), cases);
await writeFile(
  new URL("../docs/academic-evaluation.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { current: report.current, hashOnlyBaseline: report.hashOnlyBaseline },
    null,
    2,
  ),
);
if (report.current.all.passed !== cases.length) process.exitCode = 1;
