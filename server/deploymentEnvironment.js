const ALLOWED_APP_ENVIRONMENTS = new Set(["development", "staging", "production"]);

function resolveAppEnvironment(env = process.env) {
  const value = String(env.APP_ENV || env.NODE_ENV || "development").trim().toLowerCase();
  if (!ALLOWED_APP_ENVIRONMENTS.has(value)) {
    throw new Error(`APP_ENV must be one of: ${[...ALLOWED_APP_ENVIRONMENTS].join(", ")}.`);
  }
  return value;
}

function getMongoDatabaseName(connectionString = "") {
  const withoutQuery = String(connectionString).split("?")[0];
  const databaseName = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1).trim();
  return decodeURIComponent(databaseName);
}

function assertSafeDatabaseTarget({ appEnvironment, connectionString }) {
  const databaseName = getMongoDatabaseName(connectionString);
  if (!databaseName) {
    throw new Error("MONGODB_URI must include an explicit database name.");
  }

  const isStagingDatabase = /(^|[-_])stag(e|ing)([-_]|$)/i.test(databaseName);
  if (appEnvironment === "staging" && !isStagingDatabase) {
    throw new Error(
      `Staging refused to start with database \"${databaseName}\". Use a database name containing \"staging\".`
    );
  }
  if (appEnvironment === "production" && isStagingDatabase) {
    throw new Error(`Production refused to start with staging database \"${databaseName}\".`);
  }

  return databaseName;
}

module.exports = {
  assertSafeDatabaseTarget,
  getMongoDatabaseName,
  resolveAppEnvironment,
};
