const ALLOWED_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
  'postgres',
  'postgresql',
  'db',
  'database',
]);

export function assertMediaMemoryTarget(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for media memory verification');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (databaseName !== 'sekereagle_test') {
    throw new Error('media memory verification requires database sekereagle_test');
  }

  if (!ALLOWED_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `database host ${parsed.hostname || '(empty)'} is not in the local/compose allowlist`,
    );
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }

  return parsed;
}

export function percentile(samples, quantile) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('percentile requires at least one sample');
  }
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new Error('quantile must be between 0 and 1');
  }

  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? sorted[0];
}

export function evaluateMediaMemoryMeasurements(report, limits) {
  const measurementsByName = new Map(
    (report.measurements ?? []).map((measurement) => [measurement.name, measurement]),
  );
  const failures = [];

  for (const name of limits.requiredMeasurements ?? []) {
    if (!measurementsByName.has(name)) {
      failures.push(`${name} measurement is missing`);
    }
  }

  for (const measurement of report.measurements ?? []) {
    const peakLimit = limits.maximumPeakRssMiB?.[measurement.name];
    if (
      peakLimit !== undefined &&
      Number.isFinite(measurement.peakRssMiB) &&
      measurement.peakRssMiB > peakLimit
    ) {
      failures.push(
        `${measurement.name} peak RSS ${measurement.peakRssMiB.toFixed(2)}MiB exceeds ${peakLimit.toFixed(2)}MiB`,
      );
    }

    const getLimit = limits.maximumOriginalGetCount?.[measurement.name];
    if (
      getLimit !== undefined &&
      Number.isFinite(measurement.originalGetCount) &&
      measurement.originalGetCount > getLimit
    ) {
      failures.push(
        `${measurement.name} original GET count ${measurement.originalGetCount} exceeds ${getLimit}`,
      );
    }
  }

  return failures;
}
