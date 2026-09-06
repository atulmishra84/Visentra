import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAgent365CatalogPackage,
  mapAgent365PackageToObservation,
  listAgent365CatalogPackages
} from "../saasPlatforms.js";

const conn = {
  id: "c-m365",
  name: "M365 Prod",
  environment: "prod",
  config: { tenantId: "tenant-1" },
  secrets: {}
};

describe("isAgent365CatalogPackage", () => {
  it("accepts Copilot-hosted packages", () => {
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "HR Agent",
        supportedHosts: ["Copilot"],
        elementTypes: []
      }),
      true
    );
  });

  it("accepts DeclarativeAgent / CustomEngineAgent element types", () => {
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "Builder agent",
        supportedHosts: ["Teams"],
        elementTypes: ["DeclarativeAgent"]
      }),
      true
    );
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "Custom engine",
        elementTypes: ["CustomEngineAgent"]
      }),
      true
    );
  });

  it("accepts Copilot Studio platform", () => {
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "Studio bot",
        platform: "Copilot Studio",
        supportedHosts: ["Outlook"]
      }),
      true
    );
  });

  it("rejects plain Office add-ins without agent signals", () => {
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "Diligent Teams Document Uploader",
        supportedHosts: ["outlook", "word"],
        elementTypes: ["officeAddIn"],
        platform: "web"
      }),
      false
    );
  });

  it("does not invent agents from displayName alone", () => {
    assert.equal(
      isAgent365CatalogPackage({
        displayName: "Super AI Agent Bot Copilot",
        supportedHosts: ["Word"],
        elementTypes: ["officeAddIn"]
      }),
      false
    );
  });
});

describe("mapAgent365PackageToObservation", () => {
  it("maps catalog package to confirmed platform_agent", () => {
    const obs = mapAgent365PackageToObservation(conn, {
      id: "P_abc",
      displayName: "Contoso HR Agent",
      type: "custom",
      shortDescription: "Answers HR questions",
      supportedHosts: ["Copilot"],
      elementTypes: ["DeclarativeAgent"],
      platform: "Copilot Studio",
      publisher: "Contoso",
      isBlocked: false,
      version: "1.0.0"
    });
    assert.ok(obs);
    assert.equal(obs.fingerprint, "saas:m365_copilot:agent:agent365-P_abc");
    assert.equal(obs.metadata.agentStatus, "confirmed");
    assert.equal(obs.metadata.inventoryClass, "platform_agent");
    assert.equal(obs.metadata.source, "graph-agent365-catalog");
    assert.equal(obs.metadata.agent365PackageId, "P_abc");
    assert.match(obs.framework, /Copilot Studio/i);
  });

  it("returns null without package id", () => {
    assert.equal(mapAgent365PackageToObservation(conn, { displayName: "x" }), null);
  });
});

describe("listAgent365CatalogPackages", () => {
  it("lists packages from Graph v1.0 and follows nextLink", async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (String(url).includes("skiptoken")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [{ id: "P_2", displayName: "Agent Two", supportedHosts: ["Copilot"] }]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [{ id: "P_1", displayName: "Agent One", supportedHosts: ["Copilot"] }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/copilot/admin/catalog/packages?$skiptoken=abc"
        })
      };
    };

    const discoveryErrors = [];
    const result = await listAgent365CatalogPackages("token", { fetchFn, discoveryErrors });
    assert.equal(result.packages.length, 2);
    assert.equal(result.api, "v1.0");
    assert.equal(discoveryErrors.length, 0);
    assert.ok(calls[0].includes("/v1.0/copilot/admin/catalog/packages"));
  });

  it("records permission_denied when catalog returns 403", async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Agent 365 license required", code: "Forbidden" } })
    });
    const discoveryErrors = [];
    const result = await listAgent365CatalogPackages("token", { fetchFn, discoveryErrors });
    assert.equal(result.packages.length, 0);
    assert.equal(discoveryErrors.length, 1);
    assert.equal(discoveryErrors[0].discoveryStatus, "permission_denied");
    assert.equal(discoveryErrors[0].discoveryType, "agent365-catalog");
    assert.match(String(discoveryErrors[0].hint || ""), /CopilotPackages\.Read\.All/);
  });

  it("falls back to beta when v1.0 fails non-auth", async () => {
    const fetchFn = async (url) => {
      if (String(url).includes("/v1.0/")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: "Not found" } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [
            {
              id: "P_beta",
              displayName: "Beta Agent",
              supportedHosts: ["Copilot"],
              platform: "Copilot Studio"
            }
          ]
        })
      };
    };
    const result = await listAgent365CatalogPackages("token", { fetchFn, discoveryErrors: [] });
    assert.equal(result.api, "beta");
    assert.equal(result.packages[0].id, "P_beta");
  });
});
