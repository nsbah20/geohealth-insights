const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSafeDatabaseTarget,
  getMongoDatabaseName,
  resolveAppEnvironment,
} = require("./deploymentEnvironment");

test("resolves an explicit application environment", () => {
  assert.equal(resolveAppEnvironment({ APP_ENV: "Staging", NODE_ENV: "production" }), "staging");
  assert.equal(resolveAppEnvironment({ NODE_ENV: "production" }), "production");
});

test("extracts the MongoDB database name", () => {
  assert.equal(
    getMongoDatabaseName("mongodb+srv://user:secret@example.mongodb.net/geohealth_staging?retryWrites=true"),
    "geohealth_staging"
  );
});

test("requires staging to use an explicitly named staging database", () => {
  assert.throws(
    () => assertSafeDatabaseTarget({
      appEnvironment: "staging",
      connectionString: "mongodb+srv://example.mongodb.net/geohealth",
    }),
    /Staging refused to start/
  );
  assert.equal(
    assertSafeDatabaseTarget({
      appEnvironment: "staging",
      connectionString: "mongodb+srv://example.mongodb.net/geohealth-staging",
    }),
    "geohealth-staging"
  );
});

test("prevents production from targeting a staging database", () => {
  assert.throws(
    () => assertSafeDatabaseTarget({
      appEnvironment: "production",
      connectionString: "mongodb+srv://example.mongodb.net/geohealth_staging",
    }),
    /Production refused to start/
  );
});
