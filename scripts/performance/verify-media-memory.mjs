import { mediaMemoryLimits } from './media-memory-limits.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertMediaMemoryTarget,
  evaluateMediaMemoryMeasurements,
} from './media-memory-contract.mjs';

const DEFAULT_REPORT = '.omx/artifacts/media-memory-measurements.json';
const limits = mediaMemoryLimits;

const args = process.argv.slice(2);
const reportArgument = args.indexOf('--report');
const reportPath = resolve(
  reportArgument >= 0 ? (args[reportArgument + 1] ?? DEFAULT_REPORT) : DEFAULT_REPORT,
);

if (args.includes('--verify')) {
  assertMediaMemoryTarget(process.env.DATABASE_URL ?? '');
}

const report = JSON.parse(await readFile(reportPath, 'utf8'));
const failures = evaluateMediaMemoryMeasurements(report, limits);
process.stdout.write(
  `${JSON.stringify({ reportPath, limits, measurements: report.measurements, failures }, null, 2)}\n`,
);
if (failures.length) process.exitCode = 1;
