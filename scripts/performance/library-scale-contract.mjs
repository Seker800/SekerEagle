const ALLOWED_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', 'postgres', 'postgres-test']);

export function assertDedicatedScaleTarget(databaseUrl) {
  const database = new URL(databaseUrl);
  const databaseName = database.pathname.replace(/^\//, '');
  if (!ALLOWED_DATABASE_HOSTS.has(database.hostname)) {
    throw new Error(`database host is outside the SekerEagle allowlist: ${database.hostname}`);
  }
  if (databaseName !== 'sekereagle_test') {
    throw new Error(`scale verification requires the dedicated sekereagle_test database`);
  }
}

export function evaluateScaleMeasurements(report, thresholds) {
  const failures = [];
  if (report.assetCount < thresholds.requiredAssetCount) {
    failures.push(
      `asset count ${report.assetCount} is below required ${thresholds.requiredAssetCount}`,
    );
  }
  const measurements = new Map(report.measurements.map((measurement) => [measurement.name, measurement]));
  for (const [name, maximum] of Object.entries(thresholds.maximumP95Ms)) {
    const measurement = measurements.get(name);
    if (!measurement) {
      failures.push(`${name} measurement is missing`);
      continue;
    }
    if (measurement.p95Ms > maximum) {
      failures.push(
        `${name} p95 ${measurement.p95Ms.toFixed(2)}ms exceeds ${maximum.toFixed(2)}ms`,
      );
    }
  }
  return failures;
}
