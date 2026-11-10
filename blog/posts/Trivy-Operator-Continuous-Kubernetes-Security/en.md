---
title: "Trivy Operator UI Deep Dive: Every Report Tab, Explained with Real Findings"
date: 2026-11-10
tags: [trivy, trivy-operator, kubernetes, security, policy-reporter, rbac, ui, k3d]
excerpt: "A UI-first tour of Trivy Operator: how its CRDs become Policy Reports, what every Policy Reporter tab actually shows, and the real vulnerability, config, secret, and RBAC findings behind each screen."
image: Trivy-Operator-Continuous-Kubernetes-Security/og.jpg
lang: en
---

Trivy Operator does not have a UI. It has a report API.

That distinction sounds like a technicality until you try to use it during an incident. The operator writes `VulnerabilityReport`, `ConfigAuditReport`, `ExposedSecretReport`, `RbacAssessmentReport`, `SbomReport`, and `ClusterComplianceReport` objects. You can read them with `kubectl`, but a wall of YAML is not a triage workflow.

This article is a UI-first deep dive into the operator. I ran it on a 4-node k3d cluster, installed Policy Reporter with the Trivy adapter, and walked every tab against real findings. The goal is not “install another dashboard.” The goal is to understand what each screen is actually telling you, what it is not telling you, and which report object sits behind it.

## The UI layer, and why it exists

The operator's job is to watch Kubernetes, run scans, and publish reports. The UI's job is to answer questions:

- Which running image has the worst CVEs?
- Which workload is privileged or shares the host network?
- Did an image ship with a credential?
- Which ServiceAccount can do too much?
- Is this finding new, or inherited from the base image?

Rancher can show the raw CRDs, but it is a generic Kubernetes browser:

![Rancher CRD browser showing VulnerabilityReports, ExposedSecretReports, and ClusterRbacAssessmentReports](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/02-rancher-vulnerability-crds.png)

There is no CVE search, no owner, no suppression, no notification, and no cross-source view. That is the gap Policy Reporter fills.

The pipeline is: workload change → scan Job → report CRD → adapter → PolicyReport → UI.

The adapter is the important translation layer. Trivy Operator emits its own CRDs; Policy Reporter consumes the Kubernetes Policy Working Group's `PolicyReport` format. Without the adapter, the UI has nothing to display.

## Versions and the lab

- k3s `v1.36.5+k3s1`, 1 server + 3 agents
- Rancher `2.15.3`
- Trivy Operator chart `0.38.1`, application `0.36.1`
- Scanner image `aquasec/trivy:0.76.1`
- Policy Reporter chart `3.11.2`, UI `2.9.1`
- Trivy Operator PolicyReport adapter `0.11.5`

The operator was already running with `targetNamespaces: trivy-demo`. The UI deep dive is based on four workloads:

- `payments-api` — `nginx:1.19`, privileged, host network, host PID, hostPath, root.
- `legacy-web` — `nginx:1.19`, the older workload from the previous lab.
- `data-exporter` — `python:3.6-slim`, a language-runtime image with a very different CVE profile.
- `leaky-app` — `josedonizetti/trivy:secrettest`, a public test image containing a synthetic Stripe key.

The operator produced four reports per source, plus cluster-scoped RBAC and compliance reports. That is the data set behind the screenshots.

## Install the UI in the right order

Policy Reporter needs the PolicyReport CRDs before its core starts. The adapter chart can install them.

Adapter values:

```yaml
crds:
  install: true
adapters:
  vulnerabilityReports:
    enabled: true
  configAuditReports:
    enabled: true
  rbacAssessmentReports:
    enabled: true
  exposedSecretReports:
    enabled: true
  complianceReports:
    enabled: true
  infraAssessmentReports:
    enabled: true
  clusterInfraAssessmentReports:
    enabled: true
```

Install the adapter first:

```powershell
helm repo add policy-reporter https://kyverno.github.io/policy-reporter
helm repo add trivy-operator-polr-adapter https://fjogeleit.github.io/trivy-operator-polr-adapter
helm repo update
helm upgrade --install trivy-operator-polr-adapter trivy-operator-polr-adapter/trivy-operator-polr-adapter -n policy-reporter --create-namespace -f .\adapter-values.yaml --wait
```

Then install the core with the UI:

```yaml
# policy-reporter-values.yaml
ui:
  enabled: true
  ingress:
    enabled: true
    className: traefik
    hosts:
      - host: policy-reporter.127.0.0.1.nip.io
        paths:
          - path: /
            pathType: Prefix
metrics:
  enabled: true
```

```powershell
helm upgrade --install policy-reporter policy-reporter/policy-reporter -n policy-reporter -f .\policy-reporter-values.yaml --wait --timeout 5m
```

I did this in the opposite order first. The core crash-looped with:

```text
no valid reporting API group found in the cluster
```

The missing dependency was the `PolicyReport` CRD. Installing the adapter with `crds.install=true` created the API, and the core recovered on its next restart. If a controller says it cannot find a reporting API, check the CRDs before you debug the UI.

## Open the UI

For the screenshots I used a port-forward because the browser blocked the `.nip.io` host locally:

```powershell
kubectl -n policy-reporter port-forward svc/policy-reporter-ui 8082:8080
```

Open `http://localhost:8082`.

The left navigation has two groups: the default source dashboards and the policy dashboards. The source dashboards map directly to Trivy Operator report types:

- **Dashboard** — aggregate counts across sources.
- **Trivy Vulnerability** — image CVEs.
- **Trivy ConfigAudit** — workload and resource configuration checks.
- **Trivy ExposedSecrets** — secrets found inside images.
- **Trivy RbacAssessment** — Roles and ClusterRoles.

Each tab accepts the same basic controls: a result filter, a `Kinds` filter, and a search box. The `detailed` selector changes the results table; the default view is the right starting point.

## Dashboard: what the 699 means

The landing page is an aggregate, not a unique-issue count:

![Policy Reporter dashboard showing 699 fail results across Trivy vulnerability, config audit, RBAC, and secret sources](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/03-policy-reporter-dashboard.png)

The 699 fail total decomposes exactly:

- **515 vulnerability failures** from the four scans: 185 + 185 + 145 + 0.
- **72 configuration failures**: 23 + 17 + 16 + 16.
- **112 RBAC failures**: 111 cluster-scoped plus 1 namespace Role.
- **0 secret failures**: both secret findings are mapped to `warn`.

This is the first thing to understand about the UI. A number like 699 is not “699 problems to fix.” It is 699 report results, many of them duplicates across package versions, ReplicaSets, or related checks. The useful workflow is to move from the aggregate to one source tab, then to one resource.

## Trivy Vulnerability tab

The Vulnerability tab shows **1,694 results**:

- `payments-api`: 423
- `legacy-web`: 423
- `data-exporter`: 708
- `leaky-app`: 140

![Policy Reporter Trivy Vulnerability tab showing 1,694 results for the trivy-demo namespace](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/04-policy-reporter-tab-vulnerability.png)

The page mixes `fail`, `warn`, and `skip`. **Skip is not pass.** A skip usually means the scanner could not evaluate the finding, the package is not applicable, or the result is outside the selected scope. Treating skip as success is how a dashboard becomes misleading.

The 1,694 rows also are not 1,694 unique CVEs. The same CVE can appear for multiple package instances, and the same image can appear in more than one ReplicaSet. The source `VulnerabilityReport` is the authoritative per-image object; the UI is an index over those objects.

### Drilling into one workload

Opening `payments-api` shows the distribution clearly:

![Policy Reporter vulnerability detail for payments-api showing 185 failed and 202 warning results](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/08-policy-reporter-vulnerability-detail.png)

The summary is:

```text
fail results   185
warn results   202
error results  0
pass results   0
```

The table is the useful part: CVE ID, severity, and status. The severity comes from Trivy; the status comes from the PolicyReport mapping. They are different fields.

Behind that screen is a `VulnerabilityReport`:

```powershell
kubectl -n trivy-demo get vulnerabilityreport replicaset-payments-api-867449445b-api -o json
```

```json
{"criticalCount":42,"highCount":143,"mediumCount":175,"lowCount":27,"unknownCount":36}
```

The first package rows included:

```text
CVE-2022-32221  CRITICAL  curl      7.64.0-4+deb10u4
CVE-2021-22946  HIGH      curl      7.64.0-3+deb10u3
CVE-2021-37600  MEDIUM    bsdutils  2.33.1-0.1+deb10u1
CVE-2016-2781   LOW       coreutils
```

What this tab answers: **which running workload has CVEs, and what are they?**

What it does not answer: whether the vulnerable package is reachable, whether the workload processes untrusted input, or whether the image is actually deployed in production. That requires context outside the scanner.

## Trivy ConfigAudit tab

The ConfigAudit tab shows **72 failures**, all of them configuration checks:

- `payments-api`: 23
- `legacy-web`: 17
- `data-exporter`: 16
- `leaky-app`: 16

![Policy Reporter Trivy ConfigAudit tab showing 72 failures across four workloads](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/05-policy-reporter-tab-config-audit.png)

This tab is the highest-signal view for a Kubernetes security review because it tells you what the workload is allowed to do, not just what packages it contains.

### Drilling into payments-api

![Policy Reporter config audit detail for payments-api showing 23 failures, including host PID and host network](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/09-policy-reporter-config-audit-detail.png)

The high-severity checks were:

```text
Access to host PID                          AVD-KSV-0010   high
Access to host network                      AVD-KSV-0009   high
Default security context configured          AVD-KSV-0118   high
Privileged                                  AVD-KSV-0017   high
SYS_ADMIN capability added                  AVD-KSV-0005   high
Root file system is not read-only           AVD-KSV-0014   high
Kubernetes resource with disallowed volumes AVD-KSV-0121   high
```

The same screen also shows medium and low findings: hostPath mounted, seccomp disabled, runs as root, CPU and memory limits missing. This is the value of the tab: one screen connects “what the manifest says” to “why it matters.”

Behind the screen is a `ConfigAuditReport` with the same check IDs and remediations. The UI is a reader over that report, not a separate scanner.

What this tab answers: **what is dangerous about this workload's configuration?**

What it does not answer: whether the Pod actually behaved maliciously. That is runtime security, not configuration scanning.

## Trivy ExposedSecrets tab

The ExposedSecrets tab shows **2 results** for the test image:

![Policy Reporter Trivy ExposedSecrets tab showing two Stripe findings mapped to warn](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/06-policy-reporter-tab-exposed-secrets.png)

Both are `warn`, even though one is a critical Stripe secret. Open the resource to see why:

![Policy Reporter exposed secret detail showing a critical Stripe secret and a low-severity publishable key](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/10-policy-reporter-exposed-secret-detail.png)

The report behind it:

```yaml
secrets:
  - category: Stripe
    ruleID: stripe-secret-token
    title: Stripe Secret Key
    severity: CRITICAL
    target: /app/config/secret.yaml
    match: '    secret_key: **************************************'
  - category: Stripe
    ruleID: stripe-publishable-token
    title: Stripe Publishable Key
    severity: LOW
    target: /app/config/secret.yaml
```

Three points matter:

- The value is masked. The operator is not a secret-recovery tool.
- The adapter maps both findings to `result: warn`, so a policy that only routes `fail` will miss a critical secret.
- The scanner is image/content-based. Environment variables in the Deployment did not produce an `ExposedSecretReport` in this lab. A Kubernetes Secret object is a different exposure problem, handled by RBAC and etcd encryption.

What this tab answers: **did an image ship with a credential in its filesystem?**

What it does not answer: whether the credential is still valid. If it is real, rotate it. Deleting the workload does not invalidate the key.

## Trivy RbacAssessment tab

The RbacAssessment tab shows **112 failures**: 111 from cluster-scoped roles and 1 from a namespace Role.

![Policy Reporter Trivy RbacAssessment tab showing 112 failures, mostly cluster-scoped roles](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/07-policy-reporter-tab-rbac.png)

The cluster list is noisy because Trivy scans roles that existed before this lab. Use the search box to narrow to the role you care about.

Opening the lab's `support-admin` ClusterRole shows why the tab is worth checking:

![Policy Reporter RBAC detail for a wildcard ClusterRole showing two critical failures](../image/blog/Trivy-Operator-Continuous-Kubernetes-Security/11-policy-reporter-rbac-detail.png)

```yaml
checks:
  - checkID: AVD-KSV-0046
    title: Manage all resources
    severity: CRITICAL
    remediation: Remove '*' from 'rules.resources'.
  - checkID: AVD-KSV-0044
    title: No wildcard verb and resource roles
    severity: CRITICAL
    remediation: Create a role which does not permit wildcard verb on wildcard resource.
summary:
  criticalCount: 2
```

The namespace Role `secret-reader` produced a medium result instead:

```yaml
checkID: AVD-KSV-0113
title: Manage namespace secrets
severity: MEDIUM
```

What this tab answers: **which identities can do too much?**

What it does not answer: who actually used that permission. For that you need Kubernetes audit logs, not an RBAC assessment.

## Status semantics: the part that trips people up

The UI shows two different concepts that look similar:

- **Severity** comes from Trivy: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`.
- **Result** comes from the PolicyReport mapping: `fail`, `warn`, `pass`, `error`, `skip`.

They do not have to agree. In this lab, a critical Stripe secret was mapped to `warn`. That is why the dashboard's fail total was 699 while the secret tab showed two findings that were not part of that number.

`skip` is not `pass`. A skipped check can mean the scanner could not evaluate it, the resource kind is out of scope, or the policy does not apply. Read the result column, not just the color.

There is also a time dimension:

- Reports are snapshots tied to a resource revision or a scheduled compliance run.
- `scannerReportTTL` was `24h`; old ReplicaSet reports can remain after a rollout.
- Compliance ran on a six-hour cron in this lab.
- The PSS report showed `17 PASS / 0 FAIL` even after a privileged workload was created, because the report predated the workload.

A green compliance panel is not a live control. Check the timestamp and the scope.

## Metrics and Grafana

The UI is for reading individual findings. Metrics are for trends and alerting.

The operator exposes Prometheus metrics on port `8080`:

```powershell
kubectl -n trivy-system port-forward deploy/trivy-operator 8081:8080
curl.exe http://localhost:8081/metrics
```

Real samples:

```text
trivy_image_vulnerabilities{...,image_repository="library/nginx",image_tag="1.19",...severity="Critical"} 42
trivy_image_exposedsecrets{...,image_repository="josedonizetti/trivy",image_tag="secrettest",...severity="Critical"} 1
trivy_cluster_compliance{...,status="Fail",title="Kubernetes Pod Security Standards - Restricted"} 0
```

Useful queries:

```promql
sum by (namespace, resource_name) (trivy_image_vulnerabilities{severity="Critical"})
sum by (namespace, image_repository, image_tag) (trivy_image_exposedsecrets{severity="Critical"})
sum by (title, status) (trivy_cluster_compliance)
```

For a Grafana view, the official dashboard ID is `17813`. That gives time series and alerting; it does not replace the per-finding tabs.

## Operator behavior the UI reveals

The tabs are only half the lesson. The report counts expose how the operator works.

### Reports follow ReplicaSets, not Deployments

A Pod template change creates a new ReplicaSet, which creates a new report. That is why the same image can appear more than once, and why old reports can linger after a rollout. Filter by namespace and resource, and use the report TTL as part of your retention policy.

### `targetNamespaces` does not scope everything

The operator was configured with `targetNamespaces: trivy-demo`, but the RBAC tab still showed 111 cluster-scoped failures. Workload scanning is namespaced; cluster-scoped RBAC assessment is not. Plan for that volume.

### Client/server scanning cannot read node-local images

I built a local test image and imported it into the k3d nodes. The scan job failed:

```text
unable to find the specified image "lab/leaky-app:1.0" in ["docker" "containerd" "podman" "remote"]
containerd socket not found: /run/containerd/containerd.sock
```

The operator's Trivy server pulls images; it does not read the kubelet's containerd store. A `k3d image import` makes an image runnable, not pullable by the scanner. Push it to a reachable registry, or change the scan architecture deliberately.

### The operator reports; it does not prevent

Every bad workload in this lab was already running before its report existed. If a resource must never run, use admission policy such as Kyverno or Gatekeeper. The operator is the continuous backstop for drift, legacy workloads, and manual `kubectl` changes.

### The UI needs authentication

Policy Reporter exposes namespace names, image names, CVEs, and RBAC posture. The lab UI had no authentication because it was local. In production, put OIDC or an authenticated proxy in front of it.

## What each tab is best at

Use this as a reading order:

- **Dashboard** — a health summary, not a work queue.
- **Vulnerability** — image ownership and patch planning.
- **ConfigAudit** — workload hardening and admission-policy design.
- **ExposedSecrets** — incident response and credential rotation.
- **RbacAssessment** — privilege review and least-privilege cleanup.

The fastest useful loop is: start at the Dashboard, pick the source with the highest fail count, filter to one namespace, open one resource, then trace the finding back to its CRD with `kubectl`.

## Cleanup

The operator itself is part of the earlier lab. To remove only this UI and the added cases:

```powershell
helm uninstall policy-reporter -n policy-reporter
helm uninstall trivy-operator-polr-adapter -n policy-reporter
kubectl delete namespace policy-reporter

kubectl -n trivy-demo delete deployment payments-api data-exporter leaky-app
kubectl delete clusterrolebinding support-bot-support-admin
kubectl delete clusterrole support-admin
kubectl -n trivy-demo delete rolebinding support-bot-secret-reader
kubectl -n trivy-demo delete role secret-reader
kubectl -n trivy-demo delete serviceaccount support-bot
kubectl -n trivy-demo delete configmap payments-config
```

If you also want to remove the operator:

```powershell
helm uninstall trivy-operator -n trivy-system
```

Check for leftover report CRDs and PVCs before assuming cleanup is complete.

## References

- [Trivy Operator documentation](https://aquasecurity.github.io/trivy-operator/latest/)
- [Trivy Operator CRDs](https://aquasecurity.github.io/trivy-operator/latest/docs/crds/)
- [Trivy Operator metrics](https://aquasecurity.github.io/trivy-operator/latest/tutorials/integrations/metrics/)
- [Trivy Operator Grafana dashboard](https://aquasecurity.github.io/trivy-operator/latest/tutorials/grafana-dashboard/)
- [Policy Reporter integration](https://aquasecurity.github.io/trivy-operator/latest/tutorials/integrations/policy-reporter/)
- [Trivy Operator PolicyReport adapter](https://github.com/fjogeleit/trivy-operator-polr-adapter)
- [Policy Reporter documentation](https://kyverno.github.io/policy-reporter/)





