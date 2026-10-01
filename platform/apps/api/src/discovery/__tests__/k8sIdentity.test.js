import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverKubernetesIdentity } from "../k8sApi.js";

describe("discoverKubernetesIdentity", () => {
  const conn = {
    id: "k8s-id-1",
    name: "Lab cluster",
    environment: "production",
    provider: "kubernetes_identity",
    config: { apiServer: "https://k8s.lab.example:6443", skipTlsVerify: "true" },
    secrets: { token: "token" }
  };

  it("keeps AI-relevant service accounts and skips the rest", async () => {
    const { observations, stats } = await discoverKubernetesIdentity(conn, {
      list: async () => ({
        items: [
          { metadata: { name: "default", namespace: "default" } },
          {
            metadata: {
              name: "foundry-agent",
              namespace: "ai",
              labels: { app: "agent" },
              annotations: { "agent.visentra.io/model": "gpt-4o" }
            }
          },
          { metadata: { name: "nginx", namespace: "ingress" } }
        ]
      })
    });

    assert.equal(stats.serviceAccountsScanned, 3);
    assert.equal(stats.identitiesIngested, 1);
    const found = observations.find((obs) => obs.provider === "kubernetes_identity" && obs.framework === "ServiceAccount");
    assert.ok(found);
    assert.equal(found.name, "Kubernetes ServiceAccount — ai/foundry-agent");
    assert.equal(found.metadata.inventoryClass, "kubernetes_service_account");
    assert.equal(found.metadata.discoveryMode, "kubernetes-identity-live");
    assert.equal(observations.some((obs) => /nginx/.test(obs.name)), false);
  });
});
