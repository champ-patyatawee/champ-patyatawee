---
title: "Trivy for Kubernetes Security: CVEs, Misconfigurations, Secrets, and Continuous Reports"
date: 2026-11-10
tags: [trivy, kubernetes, security, k3d, rancher, sbom]
excerpt: "Build a real Trivy lab on a 4-node k3d cluster, scan an EOL nginx image, catch Kubernetes misconfigurations and synthetic secrets, and inspect Trivy Operator reports in Rancher, including a compliance false-negative that changed how I trust the reports."
image: Trivy-Kubernetes-Security-Lab/og.jpg
lang: en
---

Trivy is often described as “a vulnerability scanner for containers.” That is true, but incomplete. In a Kubernetes cluster it can inspect an image, a YAML manifest, a file tree, and a live cluster. It can also run continuously as an operator and publish findings as Kubernetes custom resources.

The important question is not “can it scan?” It is “which layer is this finding coming from, and what decision can I actually make from it?”

I built this lab on my Windows machine to answer that question with real output: **a 4-node k3d cluster (1 server + 3 agents), Rancher, an intentionally old `nginx:1.19` deployment, the Trivy CLI, and Trivy Operator**. The lab produced useful CVEs, configuration findings, a synthetic secret detection, and Kubernetes-native reports. It also produced a compliance result that contradicted the workload audit, which is exactly the kind of failure a security article should not hide.

![Rancher deployment detail showing legacy-web running nginx:1.19](../image/blog/Trivy-Kubernetes-Security-Lab/01-workload-legacy-web.png)

## What this lab found

- The `nginx:1.19` image is based on Debian 10.9, which is end-of-life. The CLI found **189 HIGH/CRITICAL vulnerabilities**; the full severity breakdown was **42 critical, 147 high, 180 medium, 45 low, and 9 unknown**.
- The `legacy-web` Deployment manifest had **3 HIGH misconfigurations**: writable root filesystem, default container security context, and a default pod security context that allows root.
- A deliberately unsafe fixture that was **never applied** had **5 HIGH misconfigurations**, including host networking, privileged mode, and a hostPath mount.
- A synthetic credentials file produced **2 exposed-secret findings**: one critical GitHub token pattern and one high Slack token pattern.
- Trivy Operator generated a `VulnerabilityReport` with **42 critical, 143 high, 175 medium, 27 low, and 36 unknown** findings. The small difference from the CLI is expected: the operator chart shipped Trivy `0.76.1`, while the CLI was `0.76.2`, and vulnerability databases change between scans.
- The PSS Restricted compliance report claimed **17 PASS / 0 FAIL** even though the same workload had 3 high and 4 medium configuration findings. That is a real false-negative risk, not a reason to celebrate a green dashboard.

## What Trivy can do, and what it cannot

Trivy is a scanner and report generator. It is not an admission controller, a runtime security monitor, or a vulnerability management program by itself.

- **Container CVEs:** Trivy scans OS packages and language dependencies in images, filesystems, repositories, and SBOMs. You still need a patch/SLA process and an owner for every image.
- **Kubernetes misconfiguration:** Built-in checks cover workloads and cluster resources, and custom Rego checks extend them. You still need admission policy if the risky YAML must be prevented from running.
- **Exposed secrets:** Trivy checks images, file trees, and Kubernetes resources for token and credential patterns. You still need rotation, history cleanup, and a secret manager.
- **Supply chain inventory:** Trivy produces CycloneDX SBOMs and Kubernetes KBOMs. You still need a trusted registry, signing, provenance, and a retention policy.
- **Continuous reports:** Trivy Operator watches workloads and generates CRDs. You still need alert routing, triage, expiry, and a human decision.
- **Compliance mapping:** Trivy maps findings to CIS, NSA, and Pod Security Standards reports. You still need independent control validation; never treat a green summary as an audit certificate.

The official Trivy documentation explicitly describes Kubernetes scanning as **experimental**, and separates the container image from the Kubernetes resource definition. That distinction matters. An image CVE and a manifest misconfiguration are different problems with different fixes.

Trivy does **not**:

- block a pod at admission time;
- detect a live process behaving maliciously;
- prove that a workload is compliant just because a control is marked PASS;
- automatically understand your business risk or patch an image;
- replace runtime tools such as Falco, Tetragon, or a managed runtime sensor.

The practical model is:

```text
Trivy finds and reports.
CI and admission policies enforce.
A runtime sensor detects behavior.
Your process decides and tracks.
```

## How the lab fits together

Everything runs from the Windows workstation. The Trivy CLI scans a local `nginx:1.19` image, a directory of Kubernetes manifests, and the live k3s API. The Trivy Operator runs inside the cluster with a `trivy-server` pod that keeps the vulnerability database cached. The operator spawns scan jobs, and those jobs write `VulnerabilityReport`, `ConfigAuditReport`, and `ExposedSecretReport` objects into the Kubernetes API, where Rancher can display them.

The lab versions were:

- k3s `v1.36.5+k3s1`
- Rancher `2.15.3`
- Trivy CLI `0.76.2`
- Trivy Operator chart `0.38.1`, operator app `0.36.1`
- Operator scanner image `aquasec/trivy:0.76.1`
- Demo image `nginx:1.19`, based on Debian `10.9`

## Prerequisites and context lock

I used the existing `rancher-lab` k3d cluster from my previous k3d/Rancher lab. Before touching anything, confirm the context and node inventory:

```powershell
kubectl config current-context
k3d cluster list
kubectl get nodes -o wide
```

The important result was `k3d-rancher-lab` with four Ready nodes:

```text
NAME                       STATUS   ROLES           AGE   VERSION
k3d-rancher-lab-agent-0    Ready    <none>          24h   v1.36.5+k3s1
k3d-rancher-lab-agent-1    Ready    <none>          24h   v1.36.5+k3s1
k3d-rancher-lab-agent-2    Ready    <none>          24h   v1.36.5+k3s1
k3d-rancher-lab-server-0   Ready    control-plane  24h   v1.36.5+k3s1
```

Do not run cluster-scoped commands until this is correct. In a machine with Rancher, EKS, GKE, and k3d contexts, “the current context looked right” is not a security control.

## Step 1: Deploy a deliberately old workload

Create an isolated namespace and apply one small Deployment:

```powershell
kubectl create namespace trivy-demo
kubectl apply -f .\work\trivy-lab\manifests\demo.yaml
kubectl -n trivy-demo rollout status deploy/legacy-web --timeout=120s
kubectl -n trivy-demo get deploy,pods -o wide
```

The manifest is intentionally simple:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: trivy-demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legacy-web
  namespace: trivy-demo
  labels:
    app: legacy-web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: legacy-web
  template:
    metadata:
      labels:
        app: legacy-web
    spec:
      containers:
        - name: web
          image: nginx:1.19
          ports:
            - containerPort: 80
```

The workload is Ready, but “Ready” only means Kubernetes can run it. It says nothing about the age of the base image or the security context.

## Step 2: Install a pinned Trivy CLI

I pinned the CLI instead of using a moving `latest` download:

```powershell
$version = "0.76.2"
$dest = "$PWD\work\trivy-lab\bin"
$zip = "$PWD\work\trivy-lab\trivy_${version}_Windows-64bit.zip"

New-Item -ItemType Directory -Force $dest | Out-Null
Invoke-WebRequest `
  "https://github.com/aquasecurity/trivy/releases/download/v${version}/trivy_${version}_Windows-64bit.zip" `
  -OutFile $zip
Expand-Archive $zip -DestinationPath $dest -Force
.\work\trivy-lab\bin\trivy.exe --version
```

```text
Version: 0.76.2
```

Pin the version in your CI image or runner too. A scanner that changes silently is another uncontrolled dependency in the supply chain.

## Step 3: Scan the image before it becomes a mystery

Run the image scan:

```powershell
.\work\trivy-lab\bin\trivy.exe image nginx:1.19 `
  --scanners vuln `
  --skip-version-check `
  --timeout 15m
```

The relevant output was:

```text
nginx:1.19 (debian 10.9)
Total: 189 (HIGH: 147, CRITICAL: 42)
```

Trivy also warned that Debian 10.9 is no longer supported by the distribution, so vulnerability detection may be insufficient because security updates are no longer provided. That is not a cosmetic warning. An EOL base image is a lifecycle problem that no amount of scanning can fix.

The findings included fixable package issues such as `CVE-2022-1664` in `dpkg`. The existence of a fixed version is useful triage data: it means rebuilding on a newer image is a concrete action, not a research project.

A useful image gate is therefore:

```powershell
.\work\trivy-lab\bin\trivy.exe image nginx:1.19 `
  --scanners vuln `
  --severity CRITICAL,HIGH `
  --exit-code 1 `
  --skip-version-check
```

`--exit-code 1` turns findings into a failing CI step. It does not decide which findings are acceptable; that remains an explicit policy choice.

## Step 4: Scan the manifest before applying it

Image scanning cannot see a privileged container, a hostPath mount, or a missing security context. Scan the YAML separately:

```powershell
.\work\trivy-lab\bin\trivy.exe config .\work\trivy-lab\manifests `
  --severity HIGH,CRITICAL `
  --skip-version-check
```

The two local files produced different results:

```text
demo.yaml          kubernetes   3 misconfigurations
insecure-pod.yaml  kubernetes   5 misconfigurations
```

The normal `demo.yaml` findings were all HIGH:

- `KSV-0014`: the container root filesystem is not read-only.
- `KSV-0118`: the container uses the default security context.
- `KSV-0118`: the pod uses a default security context that can allow root privileges.

I also created a deliberately unsafe fixture, but **did not apply it**:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: deliberately-insecure
  namespace: trivy-demo
spec:
  hostNetwork: true
  containers:
    - name: shell
      image: busybox:latest
      securityContext:
        privileged: true
        allowPrivilegeEscalation: true
      volumeMounts:
        - name: host-root
          mountPath: /host
  volumes:
    - name: host-root
      hostPath:
        path: /
```

Scanning that fixture returned five HIGH findings, including:

- `KSV-0009`: host network enabled.
- `KSV-0017`: privileged container.
- `KSV-0121`: hostPath volume mounted from `/`.

Keeping a bad fixture in a scan target is useful because it proves the check is live. Applying it to the cluster is a different decision and should be deliberate. Trivy reports the risk; it does not stop the pod.

## Step 5: Detect exposed secrets without committing real ones

I created a synthetic credentials file and scanned only for secrets:

```powershell
.\work\trivy-lab\bin\trivy.exe fs .\work\trivy-lab\fixtures `
  --scanners secret `
  --severity HIGH,CRITICAL `
  --skip-version-check
```

The fixture contained fake token patterns, never real credentials:

```text
GITHUB_TOKEN=<synthetic GitHub token pattern>
SLACK_TOKEN=<synthetic Slack token pattern>
```

Trivy found:

```text
fake-secrets.env  text  2
Total: 2 (UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 1)
```

The GitHub token pattern was CRITICAL and the Slack token pattern was HIGH. The output redacts the matched values, which is useful, but the presence of the file is still the incident. Rotate first, remove history second, and move the value to a secret manager third.

Do not test this with a real token. A scanner log, CI artifact, or screenshot can leak the value again.

## Step 6: Scan the live namespace

The CLI can also scan the running cluster. Use the explicit context and namespace:

```powershell
.\work\trivy-lab\bin\trivy.exe k8s k3d-rancher-lab `
  --include-namespaces trivy-demo `
  --report summary `
  --skip-version-check `
  --timeout 15m
```

The real workload summary was:

```text
Workload Assessment
Namespace   Resource                Vulnerabilities        Misconfigurations
trivy-demo  Deployment/legacy-web   C42 H147 M180 L45 U9
```

That is useful, but it reinforces the earlier lesson: this view is dominated by the image. The manifest-specific findings are clearer with `trivy config` or with the operator’s `ConfigAuditReport`. Do not assume one summary contains every layer.

## Step 7: Generate an SBOM and KBOM, then read the caveat

Generate a CycloneDX image SBOM:

```powershell
.\work\trivy-lab\bin\trivy.exe image nginx:1.19 `
  --format cyclonedx `
  --output .\work\trivy-lab\scan-output\nginx-1.19.cdx.json
```

Generate a Kubernetes KBOM:

```powershell
.\work\trivy-lab\bin\trivy.exe k8s k3d-rancher-lab `
  --format cyclonedx `
  --output .\work\trivy-lab\scan-output\cluster-kbom.cdx.json
```

Two traps matter here.

First, `--format cyclonedx` disables vulnerability scanning unless you explicitly add `--scanners vuln`. If you want vulnerabilities in the generated inventory, say so.

Second, scanning the KBOM back with Trivy produced this warning:

```text
Detected OS family="k3s" version="v1.36.5+k3s1"
Unsupported os family="k3s"
```

The KBOM was still generated, but the follow-up vulnerability result was not a meaningful k3s package audit. A zero result with an “unsupported OS” warning is not a clean bill of health. Vendor distributions need their own package and advisory mapping.

## Step 8: Add Trivy Operator for continuous reports

The CLI is excellent for CI and investigations. The operator is what makes findings visible inside Kubernetes.

The lab installed chart `0.38.1`, which deployed operator `0.36.1` into `trivy-system` and scoped scans to `trivy-demo`:

```powershell
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm repo update

helm upgrade --install trivy-operator aqua/trivy-operator `
  --namespace trivy-system `
  --create-namespace `
  --version 0.38.1 `
  -f .\work\trivy-lab\operator-values.yaml `
  --wait --timeout 10m
```

The final values I used were:

```yaml
targetNamespaces: trivy-demo
operator:
  builtInTrivyServer: true
  scanJobTimeout: 30m
  scanJobsConcurrentLimit: 2
trivy:
  timeout: 30m
  resources:
    requests:
      cpu: 200m
      memory: 256M
    limits:
      cpu: 1
      memory: 1Gi
  server:
    resources:
      requests:
        cpu: 300m
        memory: 512Mi
      limits:
        cpu: 2
        memory: 2Gi
```

The first install did not work with the chart defaults. The scan job timed out at five minutes while pulling the Trivy database. Setting a longer timeout helped, but the scanner still spent a long time downloading the optional Java database. On this connection, the 951 MB Java index was the bottleneck.

I tried `trivy.skipJavaDBUpdate: true`, which is logical for a non-Java nginx image. It failed with:

```text
The first run cannot skip downloading Java DB
'--skip-java-db-update' cannot be specified on the first run
```

That is a real Trivy constraint: a fresh cache cannot skip the database, even if the target image has no Java components. The final design uses the chart’s built-in Trivy server and a persistent 5 GB PVC so the database cache is not thrown away with every scan job. The server’s first start also tripped its liveness probe during the initial download, restarted once, and then became Ready.

![Trivy Operator, Trivy server, and demo pods in Rancher](../image/blog/Trivy-Kubernetes-Security-Lab/02-trivy-pods.png)

The operator watches workload changes and creates reports automatically. It is not a scheduled cron-only scanner; a new pod or workload change can trigger reconciliation. The compliance reports have a separate cron schedule.

## Step 9: Read the Kubernetes-native reports

List the report resources:

```powershell
kubectl get vulnerabilityreports,configauditreports,exposedsecretreports `
  --all-namespaces
```

The vulnerability report was tied to the ReplicaSet and container:

```text
NAMESPACE    NAME                                                    REPOSITORY      TAG    SCANNER
trivy-demo   replicaset-legacy-web-785d7ddfdb-web                    library/nginx   1.19   Trivy
```

The Rancher list makes the severity split easy to scan:

![VulnerabilityReport list showing 42 critical and 143 high findings](../image/blog/Trivy-Kubernetes-Security-Lab/03-vulnerability-list.png)

The detail view is a Kubernetes custom resource, not a purpose-built CVE UI. Rancher exposes the report as structured YAML, including the artifact digest, OS, scanner version, summary, and vulnerability entries.

![VulnerabilityReport detail showing the report summary and YAML](../image/blog/Trivy-Kubernetes-Security-Lab/04-vulnerability-detail.png)

To inspect the summary without the full JSON:

```powershell
$report = kubectl get vulnerabilityreport `
  -n trivy-demo `
  replicaset-legacy-web-785d7ddfdb-web `
  -o json | ConvertFrom-Json

$report.report.summary | Format-List
```

```text
criticalCount : 42
highCount     : 143
mediumCount   : 175
lowCount      : 27
unknownCount  : 36
```

The ConfigAuditReport answers a different question: what is wrong with the workload definition?

```powershell
kubectl get configauditreport -n trivy-demo
```

```text
NAME                                      SCANNER   AGE
replicaset-legacy-web-785d7ddfdb          Trivy     43m
```

The Rancher list shows **0 critical, 3 high, 4 medium, and 10 low** findings:

![ConfigAuditReport showing three high and four medium findings](../image/blog/Trivy-Kubernetes-Security-Lab/05-config-audit-list.png)

The failed checks included:

- root filesystem is not read-only;
- container runs as root;
- default security context is used;
- privilege escalation can be enabled;
- seccomp is not set;
- CPU and memory requests/limits are missing;
- capabilities are not dropped.

This is the layer that should drive your Pod Security Standards or admission policy. An image update will not fix these.

The operator also generated an ExposedSecretReport for the image. It was clean:

![ExposedSecretReport with zero secret findings](../image/blog/Trivy-Kubernetes-Security-Lab/06-exposed-secret-list.png)

That result does not contradict the earlier synthetic file scan. The operator scanned the `nginx:1.19` image and its Kubernetes resources, not my local `fake-secrets.env` fixture. Scan scope matters more than a generic “Trivy found secrets” statement.

## Step 10: The compliance report can be wrong

The operator registered four compliance reports:

- `k8s-cis-1.23`
- `k8s-nsa-1.0`
- `k8s-pss-baseline-0.1`
- `k8s-pss-restricted-0.1`

The initial Rancher view had blank failure/pass columns. The operator’s compliance updater is tied to a cron schedule, so the report definitions existed before their first summary run. I forced a run by temporarily changing the PSS reports to a one-minute schedule:

```powershell
kubectl patch clustercompliancereport k8s-pss-baseline-0.1 `
  --type merge -p '{"spec":{"cron":"* * * * *"}}'

kubectl patch clustercompliancereport k8s-pss-restricted-0.1 `
  --type merge -p '{"spec":{"cron":"* * * * *"}}'
```

After the run, the operator reported:

```text
k8s-pss-baseline-0.1    PASS 11  FAIL 0
k8s-pss-restricted-0.1  PASS 17  FAIL 0
```

![ClusterComplianceReports showing 11 and 17 passing checks](../image/blog/Trivy-Kubernetes-Security-Lab/07-compliance-reports.png)

That looks excellent until you compare it with the ConfigAuditReport:

```text
ConfigAuditReport: 3 HIGH, 4 MEDIUM, 10 LOW
PSS Restricted:   17 PASS, 0 FAIL
```

The same `legacy-web` workload is running as root, has a writable root filesystem, and does not enforce a seccomp profile. A restricted Pod Security profile should not be a clean pass.

I am not treating that as “the workload is fine because the dashboard is green.” In the pinned versions used here, the PSS compliance summary did not reflect the workload-level findings that `ConfigAuditReport` exposed. Possible causes include report scope, check mapping, summary semantics, or an operator/version bug. The exact cause matters less than the operational rule:

> A green compliance report is evidence to investigate, not proof of compliance.

Use compliance reports as a control-mapping layer. Cross-check the controls against workload config audits, admission policy, and an independent test. Never put a compliance dashboard on a screen and assume it is a security guarantee.

Restore the normal schedule after the one-off run:

```powershell
kubectl patch clustercompliancereport k8s-pss-baseline-0.1 `
  --type merge -p '{"spec":{"cron":"0 */6 * * *"}}'

kubectl patch clustercompliancereport k8s-pss-restricted-0.1 `
  --type merge -p '{"spec":{"cron":"0 */6 * * *"}}'
```

## Triage: turn a report into an action

A finding is not a decision. A workable triage flow is:

1. **Fix the image lifecycle first.** Replace EOL base images and rebuild on a maintained parent. Re-scan after the rebuild; do not assume the tag pulled an updated digest.
2. **Fix workload security context next.** Set `runAsNonRoot`, `allowPrivilegeEscalation: false`, drop `ALL` capabilities, use a read-only root filesystem where the app allows it, and set a seccomp profile.
3. **Separate fixed from unfixed.** `fixedVersion` tells you whether a package update is available. Unknown and unfixed findings need ownership and a time-bound exception, not silent suppression.
4. **Gate CI.** Fail builds on critical or high image findings, and scan manifests before deployment. Keep an explicit allowlist with expiry.
5. **Enforce at admission.** Use Kyverno or Gatekeeper to require the same controls you scan for. Trivy can tell you a pod is privileged; admission can stop it from running.
6. **Watch runtime.** Use Falco or a managed sensor for behavior after the container starts. A clean image scan does not detect a compromised process.
7. **Keep the reports visible.** Route operator findings to your alerting system and give each exception an owner, reason, and expiration date.

A useful rule for suppressions is:

```text
No suppression without an owner, a justification, and an expiry date.
```

`trivyignore` is a scanner input, not an approval workflow.

## CI, admission, and runtime are different controls

The easiest mistake is to install a scanner and assume the cluster is now “secure.”

- **Build:** A Trivy image scan with `--exit-code 1` catches known CVEs and exposed secrets in the built artifact. It does not catch a bad Kubernetes manifest.
- **Pre-deploy:** `trivy config` plus review catches privileged pods, hostPath mounts, and weak security contexts. It does not catch a live runtime compromise.
- **Admission:** Kyverno or Gatekeeper prevents disallowed configurations from being deployed. It does not remove a CVE already inside an allowed image.
- **Runtime:** Falco, Tetragon, or a managed sensor catches suspicious syscalls, shell execution, and network behavior. It does not prove that an unexercised vulnerable package is safe.
- **Continuous inventory:** Trivy Operator catches new workload findings as resources change. It does not provide business context or automatic remediation.

A production program needs all five, with an owner for each signal.

## Troubleshooting notes from the real lab

These are the issues I hit, not theoretical warnings:

- **Operator scan timeout at five minutes.** The default `operator.scanJobTimeout` and `trivy.timeout` were too short for the first database download. I raised both to `30m`.
- **Java DB download dominates a small image scan.** The first run downloaded a 951 MB Java index even though the image was nginx. A fresh pod cannot skip it on the first run. The built-in Trivy server with a persistent PVC is the cache-friendly design.
- **The Trivy server can restart during first DB download.** Its liveness probe failed while the cache was being populated, then it recovered. Check events before assuming the server is broken.
- **`--context` is not a Trivy `k8s` flag.** The context is positional: `trivy k8s k3d-rancher-lab ...`.
- **`--include-namespaces` changes the result set.** If a scope looks empty, verify the flag and the cluster context before concluding there are no findings.
- **CycloneDX can disable vulnerability scanning.** Add `--scanners vuln` if you want vulnerabilities in that output.
- **k3s is not a supported OS family for KBOM package matching.** A zero result with an unsupported-OS warning is not a clean audit.
- **Compliance status can lag.** The CRDs can exist before the cron-driven summary runs.
- **Compliance can disagree with ConfigAudit.** Validate the mapping and do not trust a green count blindly.

## Production checklist

- [ ] Pin the Trivy CLI, operator chart, operator image, and scanner image.
- [ ] Mirror the Trivy DB and Java DB in restricted or air-gapped environments.
- [ ] Use a persistent cache for the operator or Trivy server; size it for both databases.
- [ ] Scope `targetNamespaces` instead of scanning every namespace by default.
- [ ] Set report TTLs and storage expectations; CRDs are not free.
- [ ] Put an admission controller in front of workloads that must meet PSS.
- [ ] Route critical/high findings to an owner and an alert channel.
- [ ] Require expiry dates for suppressions and exceptions.
- [ ] Re-scan after every image rebuild, not just after a source-code change.
- [ ] Keep Rancher and the operator API private; reports describe exploitable weaknesses.
- [ ] Validate compliance results independently; do not make a dashboard the control.
- [ ] Add runtime detection because scanning is point-in-time.

## Cleanup

Remove the demo workload and the operator when the lab is finished:

```powershell
kubectl delete namespace trivy-demo
helm uninstall trivy-operator -n trivy-system
```

The Helm uninstall removes the operator resources, but CRDs may remain depending on the chart and cluster. Check before deleting them:

```powershell
kubectl get crd | Select-String 'aquasecurity'
kubectl get clustercompliancereports
```

Do not delete a namespace or CRD just because its name matches something you saw in a tutorial. Confirm the current context and the resources first.

## What I would keep

Trivy earned a place in the workflow, but not as a single “security” checkbox. The useful pattern is:

- CLI scans in CI for fast feedback;
- manifest scans before apply;
- Operator reports for continuous inventory;
- admission policy for enforcement;
- runtime detection for behavior;
- a triage process that turns findings into owned actions.

The most important result from this lab was not the 42 critical CVEs. It was the contradiction between the Restricted compliance summary and the workload audit. That is what a security report looks like in the real world: useful, incomplete, and sometimes wrong. The engineer still has to verify the layers and make the decision.

## References

- [Trivy documentation](https://trivy.dev/docs/latest/)
- [Trivy Kubernetes scanning](https://trivy.dev/docs/latest/target/kubernetes/)
- [Trivy vulnerability scanning](https://trivy.dev/docs/latest/scanner/vulnerability/)
- [Trivy secret scanning](https://trivy.dev/docs/latest/scanner/secret/)
- [Trivy reporting formats](https://trivy.dev/docs/latest/configuration/reporting/)
- [Trivy Operator overview](https://aquasecurity.github.io/trivy-operator/latest/)
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
