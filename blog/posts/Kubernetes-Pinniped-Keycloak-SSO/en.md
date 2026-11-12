---
title: "Keycloak SSO for Kubernetes with Pinniped: No ServiceAccount per User"
date: 2026-11-12
tags: [kubernetes, keycloak, pinniped, oidc, sso, rbac, k3s]
excerpt: "Add browser SSO to kubectl with Keycloak and Pinniped, map groups to RBAC, and see why one ServiceAccount per user is the wrong model."
image: Kubernetes-Pinniped-Keycloak-SSO/og.jpg
lang: en
---

The question keeps coming back in a slightly different shape: *can Keycloak create a Kubernetes ServiceAccount for each user?* The short answer is no. Keycloak is an OpenID Connect provider; it signs identity tokens. It has no Kubernetes API client and no concept of a namespace, a RoleBinding, or a workload identity.

The longer answer is more useful. You do not want one ServiceAccount per human. A ServiceAccount is an identity for a workload, with a token that is easy to copy and hard to revoke per person. What you want is a short-lived credential derived from a real login, with the person's group membership deciding what they can do.

That is what Pinniped adds. It lets `kubectl` use Keycloak SSO without changing kube-apiserver flags, and without creating a ServiceAccount for every developer. This lab installs Pinniped on the four-node `k3s-lab` cluster, logs in as `bob`, and proves the boundary with `kubectl auth whoami` and `auth can-i`.

The part that matters for a k3s lab: the Concierge runs in **ImpersonationProxy** mode. The usual token-exchange mode needs a signing key from `kube-controller-manager`, which k3s does not run as a pod. Impersonation avoids that dependency entirely.

## What gets built

| Component | Version | Role |
|---|---|---|
| Kubernetes | k3s `v1.36.5+k3s1` | four nodes, Traefik ingress |
| Keycloak | `26.8.2` | realm `lab`, client `pinniped-supervisor` |
| Pinniped | `v0.47.0` | Supervisor + Concierge + CLI |
| Traefik | `rancher/mirrored-library-traefik:3.7.13` | TLS passthrough for both Pinniped endpoints |
| kubectl | `v1.36.1` | client on Windows |
| Namespace | `guestbook` | developer-writable namespace |
| Groups | `platform-admins`, `developers` | mapped to `cluster-admin` and `edit` |

Two hostnames are published through Traefik:

- `https://pinniped.10.10.10.11.nip.io` — the Supervisor's federation endpoint.
- `https://pinniped-proxy.10.10.10.11.nip.io` — the Concierge impersonation proxy.

## The trust chain

There are three identities in this flow, and mixing them up makes the configuration look more magical than it is.

1. **The human identity.** `kubectl` invokes the Pinniped CLI as an exec credential plugin. The CLI opens a browser, the user signs in to Keycloak, and Keycloak returns an ID token containing `preferred_username` and `groups`.
2. **The cluster identity.** The Supervisor validates the Keycloak token against the realm issuer and JWKS, then issues its own short-lived token for the cluster. That token has the audience that the Concierge's `JWTAuthenticator` expects. This is the federation step: the cluster trusts the Supervisor, and the Supervisor trusts Keycloak.
3. **The Kubernetes identity.** The CLI presents the Supervisor token to the Concierge. The impersonation proxy validates it and calls the API server as the user `bob` with the groups `developers`. RBAC then decides what `bob` may do.

The Kubernetes API server never talks to Keycloak. It only sees the impersonation proxy, which is a normal Kubernetes client with permission to impersonate users and groups. That is why no API server flags are required — and also why the Concierge is a cluster-level security component that deserves the same review as the API server itself.

In a managed cluster, or any cluster with a healthy `kube-controller-manager`, the Concierge can use `TokenCredentialRequestAPI` instead. This lab cannot, because k3s does not run that controller as a pod.

## Prerequisites

- The `k3s-lab` kubeconfig at `C:\Users\C\.kube\k3s-lab.yaml`.
- Admin access to the `lab` realm in Keycloak.
- The lab CA certificate and key that signed the existing ingress certificates.
- `pinniped.exe` on `PATH`, or referenced by full path.
- A namespace for developer workloads. This lab uses `guestbook`.

Confirm the context before installing anything cluster-wide:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml get nodes
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml get ns
```

```text
NAME          STATUS   ROLES           AGE   VERSION
k3s-agent-0   Ready    <none>          20h   v1.36.5+k3s1
k3s-agent-1   Ready    <none>          20h   v1.36.5+k3s1
k3s-agent-2   Ready    <none>          20h   v1.36.5+k3s1
k3s-server    Ready    control-plane   21h   v1.36.5+k3s1
```

## Step 1: Install the Pinniped components

Pinniped ships three manifests: the Concierge CRDs, the Concierge controller, and the Supervisor. Pin the version instead of using `latest`:

```powershell
$v = "v0.47.0"
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml apply -f "https://get.pinniped.dev/$v/install-pinniped-concierge-crds.yaml"
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml apply -f "https://get.pinniped.dev/$v/install-pinniped-concierge-resources.yaml"
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml apply -f "https://get.pinniped.dev/$v/install-pinniped-supervisor.yaml"
```

Wait for both controllers:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-supervisor get pods
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-concierge get pods
```

```text
NAME                                   READY   STATUS    RESTARTS   AGE
pinniped-supervisor-79fd59b449-sqqcd   1/1     Running   0          22m
pinniped-supervisor-79fd59b449-tmvn7   1/1     Running   0          22m

NAME                                  READY   STATUS    RESTARTS   AGE
pinniped-concierge-79b5545ff7-2psb4   1/1     Running   0          22m
pinniped-concierge-79b5545ff7-j9n8v   1/1     Running   0          22m
```

Both deployments run the same pinned image, `ghcr.io/vmware/pinniped/pinniped-server:v0.47.0`.

## Step 2: Terminate TLS in Pinniped, not in Traefik

The Supervisor serves HTTPS itself. If Traefik terminates TLS and forwards plain HTTP, the OIDC discovery document advertises the wrong scheme, the callback breaks, and certificate validation fails. The ingress must pass the TCP connection through untouched.

That means a `TLSOption` or a normal `Ingress` is not enough. Use a Traefik `IngressRouteTCP` with `HostSNI` and `tls.passthrough: true`.

First, create certificates with the correct SANs, signed by the lab CA. The exact CA paths stay outside the repository:

```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout tls.key -out tls.csr \
  -subj "/CN=pinniped.10.10.10.11.nip.io"

openssl x509 -req -in tls.csr \
  -CA lab-ca.crt -CAkey lab-ca.key -CAcreateserial \
  -out tls.crt -days 825 -sha256 -extfile tls.ext
```

`tls.ext` contains the SAN and server-auth usage:

```text
subjectAltName=DNS:pinniped.10.10.10.11.nip.io
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
```

Repeat for `pinniped-proxy.10.10.10.11.nip.io`, then create the two TLS Secrets:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-supervisor create secret tls pinniped-supervisor-tls --cert=tls.crt --key=tls.key
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-concierge create secret tls pinniped-proxy-tls --cert=proxy.crt --key=proxy.key
```

The external Services and the passthrough routes:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: pinniped-supervisor-external
  namespace: pinniped-supervisor
spec:
  type: ClusterIP
  selector:
    app: pinniped-supervisor
  ports:
    - name: https
      port: 443
      targetPort: 8443
---
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: pinniped-supervisor
  namespace: pinniped-supervisor
spec:
  entryPoints: [websecure]
  routes:
    - match: HostSNI(`pinniped.10.10.10.11.nip.io`)
      services:
        - name: pinniped-supervisor-external
          port: 443
  tls:
    passthrough: true
---
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: pinniped-concierge-proxy
  namespace: pinniped-concierge
spec:
  entryPoints: [websecure]
  routes:
    - match: HostSNI(`pinniped-proxy.10.10.10.11.nip.io`)
      services:
        - name: pinniped-concierge-proxy
          port: 443
  tls:
    passthrough: true
```

Check reachability before moving on:

```powershell
curl.exe -kI https://pinniped.10.10.10.11.nip.io/
```

A `200` or `404` proves TLS and routing work. On Windows, `curl.exe` against a private CA can fail with `CERT_TRUST_REVOCATION_STATUS_UNKNOWN`; `-k` is only for the reachability check, not for a client that will actually validate the chain.

## Step 3: Create the Keycloak client

The Supervisor is a confidential OIDC client. It runs on the cluster, so a client secret is appropriate — unlike the public client used by a desktop `kubectl` plugin.

![Keycloak client `pinniped-supervisor`: confidential client, standard flow, callback to the Supervisor](../image/blog/Kubernetes-Pinniped-Keycloak-SSO/02-keycloak-pinniped-client.png)

The settings that matter:

- Client ID `pinniped-supervisor`, confidential, client-secret authentication.
- Standard flow enabled, direct access grants disabled.
- The Pinniped host as the web origin and its `/callback` path as the only redirect URI.
- A group membership mapper that writes `groups` into the ID token, with **Full group path off**.

Use these exact values:

```text
Web origin:    https://pinniped.10.10.10.11.nip.io
Redirect URI:  https://pinniped.10.10.10.11.nip.io/callback
```

The mapper is not optional. Without it, Keycloak returns no `groups` claim, the Supervisor has nothing to federate, and every user lands in Kubernetes with only `system:authenticated`.

The equivalent Admin API request (the admin password comes from the `keycloak-admin` Secret and is never printed):

```powershell
$kc = "https://keycloak.10.10.10.11.nip.io"
$token = (Invoke-RestMethod -SkipCertificateCheck -Method Post `
  -Uri "$kc/realms/master/protocol/openid-connect/token" `
  -Body @{ client_id = "admin-cli"; username = "admin"; password = $adminPassword; grant_type = "password" }).access_token
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$client = @{
  clientId = "pinniped-supervisor"
  publicClient = $false
  clientAuthenticatorType = "client-secret"
  standardFlowEnabled = $true
  directAccessGrantsEnabled = $false
  redirectUris = @("https://pinniped.10.10.10.11.nip.io/callback")
  webOrigins = @("https://pinniped.10.10.10.11.nip.io")
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -SkipCertificateCheck -Headers $headers -Method Post `
  -Uri "$kc/admin/realms/lab/clients" -Body $client
```

Then create the mapper on the new client:

```powershell
$body = @{
  name = "groups"
  protocol = "openid-connect"
  protocolMapper = "oidc-group-membership-mapper"
  config = @{
    "claim.name" = "groups"
    "full.path" = "false"
    "id.token.claim" = "true"
    "access.token.claim" = "true"
    "userinfo.token.claim" = "true"
    "introspection.token.claim" = "true"
  }
} | ConvertTo-Json -Depth 5
```

Store the client secret as a Pinniped-typed Secret. The key names `clientID` and `clientSecret` are required:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-supervisor create secret generic keycloak-client `
  --from-literal=clientID=pinniped-supervisor `
  --from-literal=clientSecret=$env:KC_CLIENT_SECRET `
  --type=secrets.pinniped.dev/oidc-client
```

## Step 4: Federate Keycloak through the Supervisor

The `OIDCIdentityProvider` describes the upstream Keycloak realm. The `FederationDomain` is what the CLI actually talks to.

```yaml
apiVersion: idp.supervisor.pinniped.dev/v1alpha1
kind: OIDCIdentityProvider
metadata:
  name: keycloak
  namespace: pinniped-supervisor
spec:
  issuer: https://keycloak.10.10.10.11.nip.io/realms/lab
  tls:
    certificateAuthorityData: <base64 of lab-ca.crt>
  authorizationConfig:
    additionalScopes: [email]
  claims:
    username: preferred_username
    groups: groups
  client:
    secretName: keycloak-client
---
apiVersion: config.supervisor.pinniped.dev/v1alpha1
kind: FederationDomain
metadata:
  name: lab
  namespace: pinniped-supervisor
spec:
  issuer: https://pinniped.10.10.10.11.nip.io
  tls:
    secretName: pinniped-supervisor-tls
  identityProviders:
    - displayName: Keycloak
      objectRef:
        apiGroup: idp.supervisor.pinniped.dev
        kind: OIDCIdentityProvider
        name: keycloak
```

Replace `<base64 of lab-ca.crt>` with the actual value:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("lab-ca.crt"))
```

Two details are load-bearing:

- The issuer must match Keycloak's realm URL exactly, including the realm name and no trailing slash. A mismatch fails discovery before anyone reaches a login page.
- `additionalScopes` must not include `offline_access` on this Keycloak version. Requesting an offline token makes Keycloak reject the code exchange, and the Supervisor surfaces it as a generic 502.

Apply it and confirm both objects are `Ready`:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml apply -f supervisor-config.yaml
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml -n pinniped-supervisor get federationdomain,oidcidentityprovider
```

```text
NAME                                                  ISSUER                                STATUS   AGE
federationdomain.config.supervisor.pinniped.dev/lab   https://pinniped.10.10.10.11.nip.io   Ready    21m

NAME                                                        ISSUER                                           STATUS   AGE
oidcidentityprovider.idp.supervisor.pinniped.dev/keycloak   https://keycloak.10.10.10.11.nip.io/realms/lab   Ready    21m
```

## Step 5: Put the Concierge into impersonation mode

This is the k3s-specific decision. The default Concierge strategy, `TokenCredentialRequestAPI`, needs the cluster signing key so it can mint client certificates. On k3s there is no `kube-controller-manager` pod to ask, so that strategy stays in `Error`:

```text
KubeClusterSigningCertificate  Error    CouldNotFetchKey
```

The ImpersonationProxy strategy does not need that key. It runs its own TLS endpoint and authenticates the caller before impersonating them.

```yaml
apiVersion: config.concierge.pinniped.dev/v1alpha1
kind: CredentialIssuer
metadata:
  name: pinniped-concierge-config
spec:
  impersonationProxy:
    mode: enabled
    externalEndpoint: pinniped-proxy.10.10.10.11.nip.io:443
    service:
      type: ClusterIP
    tls:
      secretName: pinniped-proxy-tls
      certificateAuthorityData: <base64 of lab-ca.crt>
```

`externalEndpoint` is a `host:port`, not a URL. Writing `https://pinniped-proxy...` produces:

```text
invalid port "//pinniped-proxy.10.10.10.11.nip.io"
```

After applying, the CredentialIssuer should report the impersonation proxy as healthy:

```powershell
kubectl --kubeconfig C:\Users\C\.kube\k3s-lab.yaml get credentialissuer
```

```text
NAME                        PROXYMODE   DEFAULTSTRATEGY      AGE
pinniped-concierge-config   enabled     ImpersonationProxy   22m
```

The detailed status is the useful part:

```text
KubeClusterSigningCertificate  Error    CouldNotFetchKey
ImpersonationProxy             Success  Listening
```

A mixed status is expected here. The failed strategy is not a broken install; it is the reason impersonation is enabled.

## Step 6: Trust the Supervisor and map groups to RBAC

The `JWTAuthenticator` tells the Concierge which issuer and audience to accept. The audience must match what the CLI requests, and the issuer must be the `FederationDomain`, not Keycloak.

```yaml
apiVersion: authentication.concierge.pinniped.dev/v1alpha1
kind: JWTAuthenticator
metadata:
  name: keycloak
spec:
  issuer: https://pinniped.10.10.10.11.nip.io
  audience: k3s-lab-keycloak-pinniped
  tls:
    certificateAuthorityData: <base64 of lab-ca.crt>
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: pinniped-platform-admins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: Group
    name: platform-admins
    apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pinniped-developers-edit
  namespace: guestbook
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
subjects:
  - kind: Group
    name: developers
    apiGroup: rbac.authorization.k8s.io
```

Notice the group names: `developers`, not `oidc:developers`. Pinniped passes the upstream group claim through unchanged. This is different from direct API server OIDC, where a prefix keeps the identity provider's namespace separate.

That difference is a security boundary. A Keycloak group literally named `system:masters` is not rewritten by Pinniped. Anyone who can create or join groups in Keycloak can therefore grant Kubernetes superuser access. Disable self-service group creation, restrict the realm's group-management roles, and audit group names as carefully as ClusterRoleBindings.

## Step 7: Generate a kubeconfig and log in

Generate a kubeconfig that points `kubectl` at the impersonation proxy:

```powershell
$env:NO_PROXY = "pinniped.10.10.10.11.nip.io,pinniped-proxy.10.10.10.11.nip.io,keycloak.10.10.10.11.nip.io,127.0.0.1,localhost"

C:\Users\C\bin\pinniped.exe get kubeconfig `
  --kubeconfig C:\Users\C\.kube\k3s-lab.yaml `
  --concierge-mode ImpersonationProxy `
  -o C:\Users\C\k3s-lab-pinniped.yaml
```

The discovery output is worth reading, because it shows exactly what the CLI found and validated:

```text
discovered CredentialIssuer            {"name": "pinniped-concierge-config"}
discovered Concierge endpoint          {"endpoint": "https://pinniped-proxy.10.10.10.11.nip.io"}
discovered Concierge certificate authority bundle  {"roots": 1}
discovered JWTAuthenticator            {"name": "keycloak"}
discovered OIDC issuer                 {"issuer": "https://pinniped.10.10.10.11.nip.io"}
discovered OIDC audience               {"audience": "k3s-lab-keycloak-pinniped"}
validated connection to the cluster
```

The generated kubeconfig's `server` is the proxy, not the API server:

```yaml
server: https://pinniped-proxy.10.10.10.11.nip.io
```

The first `kubectl` command opens a browser. The user authenticates to Keycloak, and the CLI exchanges that login for a short-lived Kubernetes credential:

![Keycloak sign-in reached through the Pinniped Supervisor](../image/blog/Kubernetes-Pinniped-Keycloak-SSO/01-keycloak-login.png)

After the callback, Keycloak records a normal SSO session for the Pinniped client. There is no Kubernetes ServiceAccount behind this session:

![bob's active session for the pinniped-supervisor client in Keycloak](../image/blog/Kubernetes-Pinniped-Keycloak-SSO/04-keycloak-bob-session.png)

## Step 8: Prove the identity and the boundary

Start with the identity Kubernetes actually sees:

```powershell
$env:NO_PROXY = "pinniped.10.10.10.11.nip.io,pinniped-proxy.10.10.10.11.nip.io,keycloak.10.10.10.11.nip.io,127.0.0.1,localhost"

kubectl --kubeconfig C:\Users\C\k3s-lab-pinniped.yaml auth whoami
```

```text
ATTRIBUTE                                           VALUE
Username                                            bob
Groups                                              [developers system:authenticated]
Extra: authentication.kubernetes.io/credential-id   [X509SHA256=...]
```

The username is `bob`. The only group from Keycloak is `developers`; `system:authenticated` is added by Kubernetes. That group is what the RoleBinding in `guestbook` matches.

![bob's only Keycloak group is developers, which maps to edit in the guestbook namespace](../image/blog/Kubernetes-Pinniped-Keycloak-SSO/03-keycloak-bob-groups.png)

Now test both sides of the boundary:

```powershell
kubectl --kubeconfig C:\Users\C\k3s-lab-pinniped.yaml auth can-i create deployments -n guestbook
kubectl --kubeconfig C:\Users\C\k3s-lab-pinniped.yaml auth can-i delete nodes
kubectl --kubeconfig C:\Users\C\k3s-lab-pinniped.yaml auth can-i get secrets -n kube-system
```

```text
yes
no
no
```

Reading cluster-scoped resources fails at the authorizer, and the error names the component that made the decision:

```powershell
kubectl --kubeconfig C:\Users\C\k3s-lab-pinniped.yaml get nodes
```

```text
Error from server (Forbidden): nodes is forbidden: User "bob" cannot list resource "nodes" in API group "" at the cluster scope: decision made by impersonation-proxy.concierge.pinniped.dev
```

That is the whole point. `bob` has a working `kubectl`, a real browser login, and exactly the permissions of the `developers` group — without a per-user ServiceAccount and without restarting the control plane.

## Why one ServiceAccount per user is the wrong model

It is technically possible to write a controller that watches Keycloak and creates a ServiceAccount, token, RoleBinding, and kubeconfig for every user. It is also a lot of moving parts that produce a worse security posture.

| Concern | ServiceAccount per user | Keycloak + Pinniped |
|---|---|---|
| Credential lifetime | Long-lived token until deleted | Short-lived, minted at login |
| Revocation | Delete the SA and every copy of its token | Disable the Keycloak user or session |
| Audit identity | The ServiceAccount name | The human's username and groups |
| MFA and password policy | None; the token bypasses Keycloak | Enforced by Keycloak |
| Group changes | Reconcile RBAC per user | Next login carries the new groups |
| Keycloak's role | Would need a custom Kubernetes controller | Standard OIDC provider |

A ServiceAccount is the right identity for a pod. A human should authenticate as a human.

## Does this change the Kubernetes master?

No kube-apiserver flags change, and the control plane is not restarted. Pinniped is an add-on: CRDs, two controllers, TLS endpoints, and RBAC that lets the Concierge impersonate users and groups.

That is not the same as "no cluster-level change." Installing it requires cluster-admin, it adds an impersonation endpoint that must be protected, and it makes the Supervisor part of the authentication path. If your policy forbids impersonation entirely, Pinniped's Concierge may not be acceptable; the alternative is direct API server OIDC, which requires control-plane configuration and, on many managed clusters, provider-specific setup.

## What went wrong, and why

Four failures cost most of the debugging time. Each one is a boundary, not a typo.

**1. k3s has no `kube-controller-manager` pod.** The default Concierge strategy reported `KubeClusterSigningCertificate: CouldNotFetchKey`. Enabling `ImpersonationProxy` was the fix, and it is also the reason this lab does not depend on a control-plane component that k3s does not expose.

**2. `externalEndpoint` is not a URL.** The field takes `host:port`. A scheme produces `invalid port "//pinniped-proxy..."`.

**3. `offline_access` breaks the code exchange.** With `offline_access` in the Supervisor's `additionalScopes`, Keycloak logged `CODE_TO_TOKEN_ERROR ... Offline tokens not allowed`, and the Supervisor returned a 502 during token exchange. Removing the scope fixed it. The default CLI scopes are not the same thing as the upstream scopes the Supervisor requests.

**4. The Supervisor must terminate TLS.** Traefik TLS termination makes the discovery document and callback inconsistent. `IngressRouteTCP` with `HostSNI` and `tls.passthrough: true` keeps the Supervisor's certificate end to end. On a Windows workstation behind a proxy, also add both Pinniped hosts to `NO_PROXY`; otherwise the CLI sends cluster-local hostnames to the corporate proxy.

## Security boundaries and production gaps

This lab proves the authentication chain. It is not a production deployment.

- **The impersonation proxy is powerful.** It can become any user or group. Protect its ServiceAccount, audit its logs, and do not expose it more broadly than the API server itself.
- **Keycloak group administration equals Kubernetes authorization.** With no `oidc:` prefix, a group named `system:masters` is a superuser grant. Restrict group creation and reserve `system:*`.
- **The lab CA is self-signed.** Production should use a managed certificate authority and automate rotation for both the Supervisor and proxy certificates.
- **Keycloak is a single instance.** The Supervisor's availability is now part of `kubectl` availability. Use a highly available Keycloak and a production database.
- **Supervisor storage defaults to Kubernetes Secrets.** That is acceptable for a lab; review the storage configuration and backup strategy for production.
- **Sessions and token lifetimes are policy.** Shorten them deliberately, and test what happens when Keycloak is unavailable during a login.
- **The CLI is part of the client.** Distribute a pinned `pinniped` binary and a generated kubeconfig; do not ask users to assemble either by hand.

## Cleanup

Remove the lab objects in reverse order. The CRDs are cluster-scoped, so deleting them removes every Pinniped custom resource:

```powershell
$k = "C:\Users\C\.kube\k3s-lab.yaml"

kubectl --kubeconfig $k delete jwtauthenticator keycloak --ignore-not-found
kubectl --kubeconfig $k delete clusterrolebinding pinniped-platform-admins --ignore-not-found
kubectl --kubeconfig $k -n guestbook delete rolebinding pinniped-developers-edit --ignore-not-found
kubectl --kubeconfig $k delete credentialissuer pinniped-concierge-config --ignore-not-found
kubectl --kubeconfig $k -n pinniped-supervisor delete federationdomain lab --ignore-not-found
kubectl --kubeconfig $k -n pinniped-supervisor delete oidcidentityprovider keycloak --ignore-not-found
kubectl --kubeconfig $k -n pinniped-supervisor delete ingressroutetcp pinniped-supervisor --ignore-not-found
kubectl --kubeconfig $k -n pinniped-concierge delete ingressroutetcp pinniped-concierge-proxy --ignore-not-found
kubectl --kubeconfig $k -n pinniped-supervisor delete service pinniped-supervisor-external --ignore-not-found
```

Then uninstall the controllers and CRDs:

```powershell
$v = "v0.47.0"
kubectl --kubeconfig $k delete -f "https://get.pinniped.dev/$v/install-pinniped-supervisor.yaml" --ignore-not-found
kubectl --kubeconfig $k delete -f "https://get.pinniped.dev/$v/install-pinniped-concierge-resources.yaml" --ignore-not-found
kubectl --kubeconfig $k delete -f "https://get.pinniped.dev/$v/install-pinniped-concierge-crds.yaml" --ignore-not-found
kubectl --kubeconfig $k delete namespace pinniped-supervisor pinniped-concierge --ignore-not-found
```

Finally, delete the generated kubeconfig and credential caches from the workstation, and delete the `pinniped-supervisor` client in Keycloak so no stale redirect URI or secret remains.

## Takeaways

- Keycloak cannot create Kubernetes ServiceAccounts, and a per-user ServiceAccount is the wrong abstraction for human access.
- Pinniped turns Keycloak into a Kubernetes identity source without changing API server flags.
- On k3s, use the Concierge's impersonation proxy; the token-exchange strategy needs a controller that k3s does not run.
- RBAC still decides everything. The group claim is only as safe as the system that manages group membership.
- The shortest path to a working demo is also the easiest place to over-grant. Test the negative cases, not just the successful login.

## References

- [Pinniped architecture](https://pinniped.dev/docs/background/architecture/)
- [Supported clusters](https://pinniped.dev/docs/reference/supported-clusters/)
- [Install the Supervisor](https://pinniped.dev/docs/howto/install-supervisor/)
- [Install the Concierge](https://pinniped.dev/docs/howto/install-concierge/)
- [Configure the Concierge with a Supervisor JWT authenticator](https://pinniped.dev/docs/howto/concierge/configure-concierge-supervisor-jwt/)
- [Configure the Supervisor with an OIDC identity provider](https://pinniped.dev/docs/howto/supervisor/configure-supervisor-with-dex/)
- [Kubernetes API SSO with Keycloak: direct OIDC and per-user RBAC](https://champ.patyatawee.com/blog/Kubernetes-API-Keycloak-SSO.html)