---
name: k8s-blog-deploy
description: Deploy a real Kubernetes lab on Windows/k3d and turn it into a screenshot-backed blog post in this repository — including manifests, verification, BrowserOS capture, article structure, build, preview, and approval-gated git publishing.
license: MIT
metadata:
  audience: developers
---

## What I do

- Deploys a real Kubernetes stack on the Windows/WSL2 k3d lab instead of writing a mock tutorial.
- Captures live UI and terminal evidence with BrowserOS Neo.
- Produces an English blog post with pinned versions, runnable commands, real output, screenshots, architecture, troubleshooting, and cleanup.
- Builds and previews the generated article before any git operation.
- Keeps secrets out of the repository and stages only article-related files.
- Pushes to GitHub only when the user explicitly authorizes it.

For the blog’s markdown/frontmatter rules, also read [../how-to-write-blog-posts/SKILL.md](../how-to-write-blog-posts/SKILL.md). For the site pipeline and deploy model, read [../build-and-deploy/SKILL.md](../build-and-deploy/SKILL.md).

## When to use me

Use when the user asks for one of these combined outcomes:

- “Deploy X on Kubernetes and write a blog post.”
- “Build a real lab and capture screenshots.”
- “Create a step-by-step article with commands and proof.”
- “Deploy this stack, document the traps, and prepare it for publishing.”

Do not use for a generic kubectl question with no lab or article deliverable.

## Environment

| Resource | Default |
|---|---|
| Blog repo | `D:\Champ\champ-patyatawee` (WSL `/mnt/d/Champ/champ-patyatawee`) |
| Build | `cmd.exe /c "cd /d D:\Champ\champ-patyatawee && npm run build:blog"` |
| Kubeconfig | `/mnt/c/Users/C/.kube/config` |
| Browser | BrowserOS Neo on CDP `http://127.0.0.1:9110` |
| Helm | `C:\Users\C\AppData\Local\Microsoft\WinGet\Packages\Helm.Helm_Microsoft.Winget.Source_8wekyb3d8bbwe\windows-amd64\helm.exe` |
| Git push | Windows Git/SSH; WSL does not have the GitHub key |

WSL may swallow `$VAR` and `$()` in long one-liners. Prefer explicit paths, short commands, or a small Node/Python helper for complex inspection.

## Safety rules

- Confirm the active context before every cluster-wide or destructive action.
- Never touch another context such as GKE unless the user explicitly asks.
- Pin versions and record the chart, image, CRD, and Kubernetes versions that actually ran.
- Never commit unseal keys, root tokens, passwords, kubeconfigs, private keys, or generated `init.json` files.
- Do not claim production readiness for a lab that uses `local-path`, self-signed certificates, a single machine, or manual Shamir unseal. List the production gaps explicitly.
- Do not use `git add -A`. This repo often has unrelated modified files.
- Do not push unless the user authorizes a push for the current work. A previous push does not carry forward.

## Workflow

### 1. Inspect and plan

~~~bash
export KUBECONFIG=/mnt/c/Users/C/.kube/config
kubectl config current-context
kubectl get nodes -o wide
kubectl get ns
helm list -A
~~~

Define:

- Stack, namespace, versions, and dependencies.
- Verification commands that prove the user-facing behavior.
- Screenshots needed for the article.
- Lab-only choices and production alternatives.
- Article slug, title, and whether the user wants English only.

Keep lab manifests under a task workspace such as `work/<slug>/`, not in the blog repo.

### 2. Deploy the real stack

Create manifests and install charts against the confirmed context. Verify each phase:

~~~bash
kubectl -n <ns> get pods -o wide
kubectl -n <ns> get svc,ingress
kubectl -n <ns> get events --sort-by=.lastTimestamp | tail -30
~~~

A status of `Ready` is not enough for claims about rotation, HA, or failover. Prove the behavior with a before/after check and record the real output.

### 3. Capture browser evidence

Use BrowserOS Neo, not mockups or headless fetching. Connect with Playwright:

~~~js
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9110');
const context = browser.contexts()[0];
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.screenshot({ path: 'shot.png' });
~~~

Capture the states a reader cannot infer from commands:

- Cluster/node overview.
- Workload or controller Ready/Synced state.
- Topology, peers, or policy configuration.
- Pod shell or runtime proof.
- Rotation/failover before and after.

Save originals under `work/<slug>-shots/`. Copy selected files into `image/blog/<slug>/` with numbered names. Create a 1200×630 `og.jpg`.

### 4. Write the article

Create `blog/posts/<slug>/en.md`. Do not add `th.md` unless the user asks for Thai.

Frontmatter:

~~~yaml
---
title: "Post title"
date: YYYY-MM-DD
tags: [kubernetes, security]
excerpt: "One or two sentences describing the real outcome."
image: <slug>/og.jpg
lang: en
---
~~~

Recommended structure:

1. Problem and outcome.
2. What is being built and pinned versions.
3. Architecture and trust chain, using a mermaid fence.
4. Prerequisites and context check.
5. Numbered deployment steps with real commands and output.
6. The traps encountered and the diagnosis.
7. Security boundaries and production checklist.
8. Troubleshooting.
9. Cleanup.
10. Takeaways and official references.

Reference images from the generated page with:

~~~markdown
![Caption](../image/blog/<slug>/01-state.png)
~~~

Every screenshot must be referenced exactly once. Do not include secret values in screenshots or code blocks.

### 5. Build and visual QA

~~~bash
cmd.exe /c "cd /d D:\Champ\champ-patyatawee && npm run build:blog"
~~~

Expected: `✅ Generated: blog/<slug>.html` and `✅ Generated: blog/index.html`. Missing `th.md` warnings are harmless for an English-only post.

Run the bundled QA script from a directory with Playwright installed, or set `PLAYWRIGHT_MODULE`:

~~~bash
set PLAYWRIGHT_MODULE=C:\path\to\node_modules\playwright
node skills/k8s-blog-deploy/scripts/qa-blog.js "file:///D:/Champ/champ-patyatawee/blog/<slug>.html"
~~~

Check the report and screenshots:

- All images have non-zero natural dimensions.
- Exactly one Mermaid SVG renders.
- Code blocks exist and are highlighted.
- No page/console errors.
- Mobile viewport has no horizontal overflow.
- Listing and homepage cards link to the article.
- No long command block overflows the page.

### 6. Stage and commit

Inspect the diff first:

~~~bash
git status --short
git diff --stat
git diff --cached
~~~

Stage only:

~~~text
blog/posts/<slug>/en.md
blog/<slug>.html
image/blog/<slug>/*
blog/index.html
index.html
~~~

Only include the listing/homepage files when their diff is limited to this article. Correct Windows executable-bit noise after staging:

~~~bash
git update-index --chmod=-x blog/posts/<slug>/en.md blog/<slug>.html blog/index.html index.html
~~~

Commit with a focused message. Do not use `git commit -a`.

### 7. Push only with explicit approval

Test Windows SSH if needed:

~~~bash
cmd.exe /c "ssh -T git@github.com"
~~~

Then push with Windows Git, because WSL lacks the GitHub key:

~~~bash
cmd.exe /c "cd /d D:\Champ\champ-patyatawee && git push origin main"
~~~

If WSL Git hangs with no output, cancel it and use the Windows command. Verify:

~~~bash
git status -sb
git log -1 --oneline --decorate
~~~

## Known lab traps

### Traefik re-encryption

- Put `serversscheme: https` and `serverstransport` on the **backend Service**, not the Ingress.
- Use the fully qualified transport name, for example `vault-vault-transport@kubernetescrd`.
- In Traefik 3.x use `rootCAs` and `serverName`.
- `x509: certificate is valid for 127.0.0.1, not 10.42.x.x` means verification is using the pod IP; fix `serverName`, not certificate verification.

### Vault and ESO

- `retry_join.leader_api_addr` uses API port `8200`, not Raft port `8201`.
- Vault 1.21+ Kubernetes auth roles require an audience.
- A `ClusterSecretStore` must specify `serviceAccountRef.namespace`.
- ESO `audiences` must match the Vault role audience.
- KV v2 policies use `secret/data/<name>`.
- ESO `remoteRef.key` uses the logical key, such as `demo`, when the store is mounted at `secret` with `version: v2`.
- Vault StatefulSets may use `OnDelete`; a Helm upgrade does not automatically recreate pods.
- Manual Shamir unseal is a lab choice, not a production operating model.

### Storage

- `local-path` binds data to one node and is not replicated storage.
- Raft HA does not replace snapshots or restore testing.
- Do not delete Vault PVCs during cleanup without a verified backup.

## Definition of done

- The stack is running in the intended context.
- The key behavior has observable proof.
- The article has real commands, versions, screenshots, traps, production gaps, and cleanup.
- The generated HTML exists and passes BrowserOS QA.
- Only relevant files are staged.
- The commit exists; the push happened only with explicit approval.
