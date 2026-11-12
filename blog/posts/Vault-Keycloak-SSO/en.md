---
title: "Vault SSO with Keycloak: OIDC Login and Group-Based Access"
date: 2026-11-12
tags: [vault, keycloak, sso, oidc, kubernetes, k3s, security]
excerpt: "Log into HashiCorp Vault with the Keycloak identity you already have, map Keycloak groups to Vault policies, and prove the authorization boundary against the Vault API."
image: Vault-Keycloak-SSO/og.jpg
lang: en
---

Vault's default answer to "who are you" is a token you paste in. That is fine for a bootstrap and wrong for everything after it: no central user list, no groups, and no way to cut off one person without rotating a token other people also hold.

So put Keycloak in front of it. You open the Vault UI, Vault redirects you to the existing `lab` realm, and Keycloak comes back with a signed OIDC token. Vault validates that token, reads the group claim, and applies the policies that group is entitled to. There is no Vault password to distribute and no per-user account to create inside Vault: identity is defined once, in Keycloak.

The trust runs in one direction:

- **Keycloak → Vault.** An OIDC login against the existing `lab` realm, with the group claim deciding whether you are an admin or a developer.
- **Groups → policies.** Vault external groups map claim values to `platform-admin` and `developer` policies, so access is decided in one place instead of per role.

Everything ran on the four-node k3s lab, reusing the Keycloak from the previous article. No new identity provider was created.

## What gets built

| Component | Version | Role |
|---|---|---|
| Kubernetes | k3s `v1.36.5+k3s1` | 4 nodes, `10.10.10.11`–`10.10.10.14` |
| Vault | chart `0.34.1`, app `2.0.4` | OIDC client, Raft storage, Longhorn PVC |
| Keycloak | `26.8.2` | realm `lab`, client `vault`, groups `platform-admins` / `developers` |
| Ingress | Traefik | `vault.10.10.10.11.nip.io` |
| TLS | a local CA issued for the three lab hosts | Vault verifies the OIDC issuer instead of skipping checks |

## Why the identity chain needs real TLS

Vault has no `insecure_skip_verify` switch for OIDC discovery. It fetches `https://keycloak.../realms/lab/.well-known/openid-configuration` and validates the certificate like any other Go client. The k3s Traefik default certificate is self-signed and regenerated in memory, so there is nothing to trust.

The fix is a small local CA and a Traefik default TLS store, not a disabled check:

~~~python
ca = x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name) \
    .public_key(ca_key.public_key()).serial_number(x509.random_serial_number()) \
    .not_valid_before(now - timedelta(days=1)) \
    .not_valid_after(now + timedelta(days=1825)) \
    .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True) \
    .sign(ca_key, hashes.SHA256())
~~~

The leaf covers all three hostnames, because Argo CD, Keycloak and Vault share the same ingress:

~~~yaml
apiVersion: traefik.io/v1alpha1
kind: TLSStore
metadata:
  name: default
  namespace: kube-system
spec:
  defaultCertificate:
    secretName: lab-tls
~~~

One extra secret was needed. Argo CD's chart declares `argocd-server-tls` on its ingress, and Traefik logs `secret argocd/argocd-server-tls does not exist` on every reconcile until the secret exists. Creating it from the same CA makes all three hosts consistent:

~~~powershell
kubectl -n argocd create secret tls argocd-server-tls --cert=tls.crt --key=tls.key
~~~

Verify what is actually served before blaming Vault:

~~~python
subject: CN=vault.10.10.10.11.nip.io
issuer: CN=k3s lab CA
sans: ['argocd.10.10.10.11.nip.io', 'keycloak.10.10.10.11.nip.io', 'vault.10.10.10.11.nip.io']
~~~

## Step 1: register Vault as a Keycloak client

The realm, users and groups already exist. Only a new confidential client is needed. Using the admin API keeps it repeatable:

~~~powershell
$client = @{
  clientId = 'vault'
  publicClient = $false
  standardFlowEnabled = $true
  directAccessGrantsEnabled = $false
  redirectUris = @(
    'https://vault.10.10.10.11.nip.io/ui/vault/auth/oidc/oidc/callback',
    'https://vault.10.10.10.11.nip.io/oidc/callback'
  )
  protocolMappers = @(@{
    name = 'groups'
    protocol = 'openid-connect'
    protocolMapper = 'oidc-group-membership-mapper'
    config = @{
      'claim.name' = 'groups'
      'full.path' = 'false'
      'id.token.claim' = 'true'
      'userinfo.token.claim' = 'true'
    }
  })
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post `
  -Uri 'https://keycloak.10.10.10.11.nip.io/admin/realms/lab/clients' `
  -Headers @{ Authorization = "Bearer $token" } -Body $client
~~~

![Keycloak client for Vault with the callback URI](../image/blog/Vault-Keycloak-SSO/08-keycloak-client.png)

The redirect path is the part people get wrong. Vault's UI callback is `/ui/vault/auth/oidc/oidc/callback` — the auth mount path appears twice because the first `oidc` is the mount and the second is the method type.

## Step 2: deploy Vault

Standalone Raft with a Longhorn volume is enough to prove the model. It is not highly available, and that limitation is listed honestly at the end.

~~~yaml
server:
  standalone:
    enabled: true
    config: |
      ui = true
      api_addr = "https://vault.10.10.10.11.nip.io"

      listener "tcp" {
        tls_disable = 1
        address = "[::]:8200"
        cluster_address = "[::]:8201"
      }

      storage "raft" {
        path = "/vault/data"
      }

      service_registration "kubernetes" {}
  dataStorage:
    enabled: true
    size: 5Gi
    storageClass: longhorn
  ingress:
    enabled: true
    ingressClassName: traefik
~~~

`api_addr` is what Vault uses to build the redirect URI it returns to Keycloak. Without it the callback points at the pod's internal address and the login dies at the Keycloak redirect.

~~~powershell
helm upgrade --install vault hashicorp/vault --version 0.34.1 `
  -n vault --create-namespace -f vault-values.yaml
~~~

Then initialise and unseal. The unseal key and root token stay on the workstation, never in the repository:

~~~powershell
kubectl -n vault exec vault-0 -- `
  sh -c 'VAULT_ADDR=http://127.0.0.1:8200 vault operator init -key-shares=1 -key-threshold=1 -format=json' > init.json
kubectl -n vault exec vault-0 -- `
  sh -c "VAULT_ADDR=http://127.0.0.1:8200 vault operator unseal $key"
~~~

~~~
Seal Type      shamir
Initialized    true
Sealed         false
Version        2.0.4
~~~

## Step 3: secrets and policies

Two policies define the boundary. The developer policy is deliberately narrow: read and list under `dev/`, nothing else, and no permission to list the engine root.

~~~hcl
# developer
path "secret/data/dev/*" {
  capabilities = ["read", "list"]
}
path "secret/metadata/dev/*" {
  capabilities = ["read", "list"]
}
~~~

~~~hcl
# platform-admin
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
~~~

Two paths make the demo concrete:

~~~powershell
vault kv put secret/dev/app  username=app-dev password=... endpoint=https://api.dev.lab
vault kv put secret/prod/db  username=app-prod password=... host=keycloak-db.keycloak.svc
~~~

## Step 4: point Vault at Keycloak

This is where the CA from the first section pays off. `oidc_discovery_ca_pem` is the only way to make Vault trust a private issuer without weakening the connection.

~~~powershell
vault auth enable oidc

vault write auth/oidc/config `
  oidc_discovery_url="https://keycloak.10.10.10.11.nip.io/realms/lab" `
  oidc_client_id="vault" `
  oidc_client_secret="$CLIENT_SECRET" `
  oidc_discovery_ca_pem=@ca.crt `
  default_role="default"

vault write auth/oidc/role/default `
  bound_audiences="vault" `
  allowed_redirect_uris="https://vault.10.10.10.11.nip.io/ui/vault/auth/oidc/oidc/callback" `
  allowed_redirect_uris="https://vault.10.10.10.11.nip.io/oidc/callback" `
  user_claim="sub" `
  groups_claim="groups" `
  policies="default" `
  ttl="1h"
~~~

Note `policies="default"` on the role. Group membership is what grants real access, which means the policy decision lives in one place instead of being duplicated per role.

Groups are attached as external identities, with aliases named exactly like the claim values:

~~~powershell
vault write identity/group name="platform-admins" type="external" policies="platform-admin"
vault write identity/group name="developers"      type="external" policies="developer"

vault write identity/group-alias name="platform-admins" `
  mount_accessor="$OIDC_ACCESSOR" canonical_id="$ADMIN_GROUP_ID"
vault write identity/group-alias name="developers" `
  mount_accessor="$OIDC_ACCESSOR" canonical_id="$DEV_GROUP_ID"
~~~

If `full.path` were `true` in the Keycloak mapper, the alias names would need to be `/platform-admins` and `/developers`. This mismatch is the most common reason a correctly authenticated user lands with no permissions.

## Step 5: log in as the admin

The Vault login page sends you straight to Keycloak:

![Vault login page with the OIDC method](../image/blog/Vault-Keycloak-SSO/01-vault-login.png)

![Keycloak login form](../image/blog/Vault-Keycloak-SSO/02-keycloak-login.png)

Alice is in `platform-admins`, so she sees both trees:

![Both dev and prod visible to the platform admin](../image/blog/Vault-Keycloak-SSO/03-alice-secrets.png)

![Production secret readable by the admin](../image/blog/Vault-Keycloak-SSO/04-alice-prod-secret.png)

The UI masks values by default, which is why these screenshots are safe to publish at all.

## Step 6: prove the developer boundary

Bob logs in with the same flow and a different group. His token carries exactly two policies:

~~~json
{ "policies": ["default", "developer"] }
~~~

The practical consequences are visible in the UI. He cannot list the engine root, so Vault falls back to asking for a path:

![Developer cannot list the secrets engine root](../image/blog/Vault-Keycloak-SSO/05-bob-root-denied.png)

He can read the development secret:

![Developer reads the dev secret](../image/blog/Vault-Keycloak-SSO/06-bob-dev-allowed.png)

And the production path is refused:

![Developer is denied on the production secret](../image/blog/Vault-Keycloak-SSO/07-bob-prod-denied.png)

The API agrees, which is the check that actually matters:

~~~powershell
curl.exe -k -H "X-Vault-Token: $BOB_TOKEN" https://vault.10.10.10.11.nip.io/v1/secret/data/prod/db
~~~

~~~json
{"errors":["1 error occurred:\n\t* permission denied\n\n"]}
~~~

A 403 from the API is proof. A hidden menu item is not.

## The failures that cost time

**Vault's UI runs OIDC in a popup.** Navigating the same tab to the callback URL produces `Cannot read properties of null (reading 'postMessage')`, because the callback page posts the token back to `window.opener`. If you are automating the flow, drive the popup, not the tab.

**A stale SPA route can look like a permission bug.** After logging in as the developer in a tab that previously held the admin session, the production page still rendered its path metadata. The API returned 403 the whole time. Always confirm authorization with a request, not with a page that may be showing cached shell state.

**One Vault page wedged the browser renderer.** The Access → Auth Methods welcome page hung `Page.captureScreenshot` for every page in that tab until it was closed. Reopening a fresh tab restored screenshots. Worth knowing before concluding the UI is broken.

**Traefik kept logging a missing secret.** Argo CD's ingress declared `argocd-server-tls` while the chart did not create it, so the route fell back to the default certificate and Traefik logged an error on every reconcile. Creating the secret from the lab CA fixed both the warning and the certificate consistency.

## What this lab proves and what it does not

Proved: OIDC login through a private CA, group claims arriving in Vault as external identities, a group-to-policy mapping that survives re-login, and a 403 from the API when a developer reaches for production data.

Not proved: availability. One Vault pod with Raft on a single Longhorn volume means an unseal after every restart and a full outage if that volume is lost. Keycloak being down also blocks every login, which is the cost of centralising identity. There is no audit device enabled, which in a real deployment would be the first thing to add, because "who read `secret/prod/db`" is the question Vault exists to answer.

## Production checklist

- Run Vault with three Raft nodes, auto-unseal through a KMS or transit seal, and a real backup of the Raft snapshots.
- Enable at least one audit device before storing anything that matters.
- Replace the lab CA with a managed certificate and keep `oidc_discovery_ca_pem` only if the issuer is genuinely private.
- Set an explicit `ttl` on the OIDC role and a shorter one for admin access; identity proves who you are, not how long a session should live.
- Keep the group-to-policy mapping in Vault identity groups only. Duplicating it on each login role guarantees the two copies drift.
- Add `bound_claims` for tenant or environment so a group alone is not sufficient for production access.
- Store the root token in a break-glass process, not in a file on the workstation.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `x509: certificate signed by unknown authority` during OIDC config | Vault cannot verify the issuer certificate | Supply `oidc_discovery_ca_pem` or use a trusted CA |
| `invalid_redirect_uri` after Keycloak login | Callback path does not match the client exactly | Register `/ui/vault/auth/oidc/oidc/callback` verbatim |
| Login succeeds, no permissions | Group claim and alias names disagree | Check `full.path` and the alias names |
| `Cannot read properties of null (reading 'postMessage')` | Callback opened in the same tab | Use the popup flow |
| User lands in the wrong policy | Keycloak group missing from the token | Check the group mapper and `groups_claim` |

## Cleanup

~~~powershell
helm -n vault uninstall vault
kubectl delete namespace vault --ignore-not-found
~~~

Removing the namespace also removes the Raft volume, which means the unseal keys become useless. Export what you need first.

## Takeaways

SSO to Vault has three moving parts: Keycloak proves identity, the group claim carries authorization, and Vault policies decide what that group can touch. The part that usually breaks is not the login flow. It is the name of the group on each side. Keep the claim, the alias, and the policy file in sync, verify authorization against the API instead of the UI, and treat unseal keys and root tokens as the break-glass material they are.

## References

- [Vault: OIDC auth method](https://developer.hashicorp.com/vault/docs/auth/jwt)
- [Vault: External groups and aliases](https://developer.hashicorp.com/vault/docs/secrets/identity)
- [Vault: Kubernetes Helm chart](https://developer.hashicorp.com/vault/docs/platform/k8s/helm)
- [Keycloak: Server administration guide](https://www.keycloak.org/docs/latest/server_admin/)

