import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgent365DeepProfile,
  enrichAgent365Observation,
  enrichAgent365WithDeepScan,
  extractCapabilitiesFromElementDetails,
  normalizeAgent365PackageDetail,
} from "../agent365DeepScan.js";
import { mapAgent365PackageToObservation } from "../saasPlatforms.js";

const conn = {
  id: "c-m365",
  name: "M365 Prod",
  environment: "prod",
  config: { tenantId: "tenant-1" },
  secrets: {},
};

const sampleDetail = {
  id: "P_hr",
  displayName: "Contoso HR Agent",
  shortDescription: "Answers employee PII questions",
  longDescription: "HR helper for personal employee data and benefits.",
  status: "published",
  type: "custom",
  isBlocked: false,
  supportedHosts: ["Copilot", "Teams"],
  availableToGestures: ["allUsers"],
  deployedToGestures: ["allUsers"],
  availableTo: [{ id: "group-1", displayName: "All Employees" }],
  deployedTo: [{ id: "group-1", displayName: "All Employees" }],
  sensitivityLabel: { id: "sl-1", displayName: "Confidential" },
  categories: ["HR", "Productivity"],
  elementDetails: [
    {
      elementId: "el-1",
      elementType: "declarativeAgent",
      definition: JSON.stringify({
        name: "HR Declarative Agent",
        instructions: "You are an HR assistant. Never share secrets. Use tools carefully.",
        capabilities: [
          {
            name: "SharePointHRSite",
            type: "knowledge",
            description: "SharePoint HR knowledge base with employee PII",
          },
          {
            name: "lookup_employee",
            type: "tool",
            description: "Looks up employee profile via Graph API",
          },
          {
            name: "run_python_code",
            type: "capability",
            description: "Code interpreter for HR analytics",
          },
        ],
      }),
    },
  ],
};

describe("normalizeAgent365PackageDetail", () => {
  it("normalizes camelCase Graph package detail", () => {
    const n = normalizeAgent365PackageDetail(sampleDetail);
    assert.equal(n.id, "P_hr");
    assert.equal(n.displayName, "Contoso HR Agent");
    assert.ok(n.description.includes("HR helper"));
    assert.equal(n.elementDetails.length, 1);
    assert.equal(n.sensitivityLabel.displayName, "Confidential");
  });
});

describe("extractCapabilitiesFromElementDetails", () => {
  it("extracts tools, KBs, and instruction text from declarative definitions", () => {
    const extracted = extractCapabilitiesFromElementDetails(sampleDetail.elementDetails);
    assert.ok(extracted.instructionText.includes("HR assistant"));
    assert.ok(extracted.tools.some((t) => /lookup_employee/i.test(t.name)));
    assert.ok(extracted.tools.some((t) => /run_python_code/i.test(t.name)));
    assert.ok(extracted.knowledgeBases.some((k) => /SharePointHRSite/i.test(k.name)));
  });
});

describe("buildAgent365DeepProfile", () => {
  it("builds aws-deep.v2-compatible profile without full instruction text", () => {
    const deep = buildAgent365DeepProfile({ packageDetail: sampleDetail, apiVersion: "v1.0" });
    assert.equal(deep.schemaVersion, "agent365-deep.v1");
    assert.equal(deep.awsDeepCompatible, "aws-deep.v2");
    assert.equal(deep.deepScan, "agent365_catalog_package_detail");
    assert.equal(deep.instructions.present, true);
    assert.ok(deep.instructions.hash);
    assert.ok(deep.instructions.preview);
    assert.equal("instructionText" in deep, false);
    assert.equal("instructionFull" in deep, false);
    assert.ok(deep.toolCount >= 2);
    assert.ok(deep.knowledgeBaseCount >= 1);
    assert.ok(deep.dataClasses.includes("pii"));
    assert.ok(deep.dataClasses.includes("labeled"));
    assert.equal(deep.identity.identity_type, "microsoft_entra");
    assert.equal(deep.access.availableToGestures[0], "allUsers");
  });
});

describe("enrichAgent365Observation", () => {
  it("attaches metadata.deep and adversarial_surface like AWS", () => {
    const base = mapAgent365PackageToObservation(conn, {
      id: "P_hr",
      displayName: "Contoso HR Agent",
      supportedHosts: ["Copilot"],
      elementTypes: ["DeclarativeAgent"],
      platform: "Copilot Studio",
    });
    assert.ok(base);
    assert.equal(base.metadata.hasInstructions, false);

    const enriched = enrichAgent365Observation(base, sampleDetail, { apiVersion: "v1.0" });
    assert.equal(enriched.metadata.deepScanStatus, "ok");
    assert.equal(enriched.metadata.deepScanSchema, "agent365-deep.v1");
    assert.equal(enriched.metadata.deepScan, "agent365_catalog_package_detail");
    assert.ok(enriched.metadata.deep);
    assert.equal(enriched.metadata.deep.toolCount, enriched.metadata.toolCount);
    assert.ok(enriched.metadata.adversarial_surface);
    assert.equal(enriched.metadata.adversarial_surface.agent_detected, true);
    assert.equal(enriched.metadata.adversarial_surface.category, "agent");
    assert.ok(enriched.metadata.adversarial_surface.tools.length >= 2);
    assert.equal(enriched.metadata.adversarial_surface.instructions.present, true);
    assert.ok(enriched.metadata.adversarial_surface.data_access.has_pii);
    assert.ok(
      enriched.metadata.adversarial_surface.connectivity.code_execution === true ||
        enriched.metadata.adversarial_surface.tools.some((t) => t.risk_flags?.can_execute_code)
    );
    assert.ok(Array.isArray(enriched.metadata.adversarial_surface.identity_and_access.permissions));
    assert.ok(enriched.metadata.hasInstructions);
  });
});

describe("enrichAgent365WithDeepScan", () => {
  it("leaves non-catalog observations unchanged", async () => {
    const other = {
      fingerprint: "saas:m365_copilot:agent:sp-1",
      metadata: { source: "graph-servicePrincipals" },
    };
    const out = await enrichAgent365WithDeepScan([other], "token");
    assert.equal(out[0], other);
  });

  it("stamps permission_denied when package detail is forbidden", async () => {
    const base = mapAgent365PackageToObservation(conn, {
      id: "P_denied",
      displayName: "Denied Agent",
      supportedHosts: ["Copilot"],
      elementTypes: ["Bot"],
    });

    const fetchFn = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Forbidden" } }),
    });

    const out = await enrichAgent365WithDeepScan([base], "token", { limit: 5, fetchFn });
    assert.equal(out[0].metadata.deepScanStatus, "permission_denied");
    assert.ok(String(out[0].metadata.deepScanError || "").length > 0);
    assert.ok(!out[0].metadata.deep);
    assert.ok(out[0].metadata.adversarial_surface);
  });

  it("enriches when Graph package detail succeeds", async () => {
    const base = mapAgent365PackageToObservation(conn, {
      id: "P_hr",
      displayName: "Contoso HR Agent",
      supportedHosts: ["Copilot"],
      elementTypes: ["DeclarativeAgent"],
    });

    const fetchFn = async (url) => {
      assert.match(String(url), /catalog\/packages\/P_hr/);
      return {
        ok: true,
        status: 200,
        json: async () => sampleDetail,
      };
    };

    const out = await enrichAgent365WithDeepScan([base], "token", { fetchFn });
    assert.equal(out[0].metadata.deepScanStatus, "ok");
    assert.ok(out[0].metadata.deep.tools.length >= 1);
    assert.ok(out[0].metadata.adversarial_surface.tools.length >= 1);
  });
});
