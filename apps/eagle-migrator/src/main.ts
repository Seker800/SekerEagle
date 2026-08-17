#!/usr/bin/env node
import { executeCli } from './cli';
import { redactSensitiveText } from './secrets';

executeCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(redactSensitiveText(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
