import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PROVIDER_FIELDS } from "../connectors.js";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.resolve(srcRoot, "..");

function providerCheckList(sql) {
  const match = sql.match(/CREATE TABLE IF NOT EXISTS connectors \([\s\S]*?CHECK \(provider IN \(([\s\S]*?)\)\)/);
  assert.ok(match, "connectors provider check not found");
  return match[1];
}

describe("connectors_provider_check", () => {
  const providers = Object.keys(PROVIDER_FIELDS);

  it("registers the gateway, tracing, and proxy providers", () => {
    for (const provider of ["api_gateway", "otel_tracing", "network_proxy"]) {
      assert.ok(PROVIDER_FIELDS[provider], provider);
    }
  });

  it("lists every creatable provider in the API schema", () => {
    const sql = fs.readFileSync(path.join(apiRoot, "schemas/postgres.sql"), "utf8");
    const list = providerCheckList(sql);
    for (const provider of providers) {
      assert.match(list, new RegExp(`'${provider}'`), `schema missing ${provider}`);
    }
  });

  it("rebuilds the live constraint from PROVIDER_FIELDS on migrate", () => {
    const migrate = fs.readFileSync(path.join(srcRoot, "migrate.js"), "utf8");
    assert.match(migrate, /Object\.keys\(PROVIDER_FIELDS\)/);
    assert.match(migrate, /connectors_provider_check/);
  });
});
