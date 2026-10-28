import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, parseAllDocuments } from "yaml";
const file = (name: string) =>
  parse(readFileSync(`deploy/k8s/qd/${name}.yaml`, "utf8"));
test("k3s单实例、持久化、非root与HTTPS配置不退化", () => {
  assert.match(file("kustomization").images[0].digest, /^sha256:[a-f0-9]{64}$/);
  const deployment = file("deployment");
  const pod = deployment.spec.template.spec;
  const container = pod.containers[0];
  assert.equal(deployment.spec.replicas, 1);
  assert.equal(deployment.spec.strategy.type, "Recreate");
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.securityContext.runAsNonRoot, true);
  assert.equal(container.securityContext.readOnlyRootFilesystem, true);
  assert.equal(
    pod.volumes.find((v: { name: string }) => v.name === "data")
      .persistentVolumeClaim.claimName,
    "rectify-data",
  );
  const env = Object.fromEntries(
    container.env.map((v: { name: string; value: string }) => [
      v.name,
      v.value,
    ]),
  );
  assert.equal(env.COOKIE_SECURE, "true");
  assert.equal(env.TRUSTED_PROXIES, "10.77.0.1/32");
  assert(!("RECTIFY_BOOTSTRAP_PASSWORD" in env));
});
test("存储Retain、外部入口限制来源，Argo不自动prune", () => {
  const storage = parseAllDocuments(
    readFileSync("deploy/k8s/qd/storage.yaml", "utf8"),
  ).map((d) => d.toJSON());
  assert.equal(storage[0].reclaimPolicy, "Retain");
  assert.match(
    storage[1].metadata.annotations["argocd.argoproj.io/sync-options"],
    /Delete=false/,
  );
  const service = file("service");
  assert.equal(service.spec.externalTrafficPolicy, "Local");
  assert.equal(service.spec.allocateLoadBalancerNodePorts, false);
  assert(!service.spec.loadBalancerSourceRanges.includes("0.0.0.0/0"));
  const app = parse(readFileSync("deploy/argocd/application.yaml", "utf8"));
  assert(!app.spec.syncPolicy.automated);
});
test("公网边缘覆盖转发头并使用HTTPS证书，不绕过身份认证", () => {
  const nginx = readFileSync("deploy/edge/rectify.conf", "utf8");
  assert.match(nginx, /server_name rec\.deepsingularity\.cn/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto https;/);
  assert.match(nginx, /return 301 https:/);
  assert(!nginx.includes("Authorization"));
});
