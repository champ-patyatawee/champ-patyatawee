---
title: "Vault + Keycloak: SSO for Humans, Short-Lived Credentials for Apps"
date: 2026-11-12
tags: [vault, keycloak, sso, oidc, kubernetes, k3s, security, postgres]
excerpt: "Log into HashiCorp Vault with the Keycloak identity you already have, map Keycloak groups to Vault policies, then let Vault issue five-minute PostgreSQL credentials for the Keycloak database itself."
image: Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/og.jpg
lang: en
---

A Vault deployment with its own password database is a second identity system nobody asked for. The more useful pattern is the one this lab builds: Keycloak authenticates the human, Vault maps the human's groups to policies, and the same Vault instance also removes the static database password that Keycloak itself uses.

Two directions of trust, one cluster:

- **Humans → Vault.** An OIDC login against the existing `lab` realm, with Keycloak's group claim deciding whether you are an admin or a developer.
- **Vault → PostgreSQL.** Vault holds one privileged connection and hands out five-minute roles instead of a shared password, then drops the role when the lease is revoked.

Everything ran on the four-node k3s lab, reusing the Keycloak from the previous article. No new identity provider was created.

## What gets built

| Component | Version | Role |
|---|---|---|
| Kubernetes | k3s `v1.36.5+k3s1` | 4 nodes, `10.10.10.11`–`10.10.10.14` |
| Vault | chart `0.34.1`, app `2.0.4` | OIDC client, Raft storage, Longhorn PVC |
| Keycloak | `26.8.2` | realm `lab`, client `vault`, groups `platform-admins` / `developers` |
| PostgreSQL | `postgres:16-alpine` | Keycloak's database; target of the dynamic credentials |
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

![Keycloak client for Vault with the callback URI](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/08-keycloak-client.png)

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

![Vault login page with the OIDC method](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/01-vault-login.png)

![Keycloak login form](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/02-keycloak-login.png)

Alice is in `platform-admins`, so she sees both trees:

![Both dev and prod visible to the platform admin](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/03-alice-secrets.png)

![Production secret readable by the admin](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/04-alice-prod-secret.png)

The UI masks values by default, which is why these screenshots are safe to publish at all.

## Step 6: prove the developer boundary

Bob logs in with the same flow and a different group. His token carries exactly two policies:

~~~json
{ "policies": ["default", "developer"] }
~~~

The practical consequences are visible in the UI. He cannot list the engine root, so Vault falls back to asking for a path:

![Developer cannot list the secrets engine root](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/05-bob-root-denied.png)

He can read the development secret:

![Developer reads the dev secret](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/06-bob-dev-allowed.png)

And the production path is refused:

![Developer is denied on the production secret](../image/blog/Vault-Keycloak-SSO-and-Dynamic-DB-Credentials/07-bob-prod-denied.png)

The API agrees, which is the check that actually matters:

~~~powershell
curl.exe -k -H "X-Vault-Token: $BOB_TOKEN" https://vault.10.10.10.11.nip.io/v1/secret/data/prod/db
~~~

~~~json
{"errors":["1 error occurred:\n\t* permission denied\n\n"]}
~~~

A 403 from the API is proof. A hidden menu item is not.

## Step 7: issue short-lived PostgreSQL credentials

The second half of the lab has nothing to do with SSO, and that is the point: the same Vault that authenticates people can also remove the static password Keycloak uses to reach its database.

~~~powershell
vault secrets enable database

vault write database/config/keycloak `
  plugin_name=postgresql-database-plugin `
  connection_url="postgresql://{{username}}:{{password}}@keycloak-db.keycloak.svc:5432/keycloak?sslmode=disable" `
  allowed_roles="keycloak-readonly" `
  username="keycloak" password="$POSTGRES_ADMIN_PASSWORD"

vault write database/roles/keycloak-readonly `
  db_name=keycloak `
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT CONNECT ON DATABASE keycloak TO \"{{name}}\"; GRANT USAGE ON SCHEMA public TO \"{{name}}\"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" `
  default_ttl="5m" max_ttl="1h"
~~~

Reading credentials creates a real PostgreSQL role, not a stored secret:

~~~powershell
vault read database/creds/keycloak-readonly
~~~

~~~
Key                Value
---                -----
lease_id           database/creds/keycloak-readonly/GDqqrl...
lease_duration     5m
lease_renewable    true
password           A1a-...redacted
username           v-root-keycloak-PNllHaWWarkqyk6VlSVv-1794451806
~~~

The username is generated per lease. The role is named from the Vault entity, the role, and an expiry stamp. Five minutes later it stops working whether or not anyone remembers to clean up.

Proving it from inside the cluster:

~~~powershell
kubectl -n keycloak run psql-lease-test --restart=Never --image=postgres:16-alpine `
  --env="PGPASSWORD=$LEASE_PASSWORD" -- `
  psql -h keycloak-db -U $LEASE_USER -d keycloak `
       -c "select current_user, (select count(*) from client) as clients;"
~~~

~~~
                  current_user                   | clients
-------------------------------------------------+---------
 v-root-keycloak-PNllHaWWarkqyk6VlSVv-1794451806 |      15
~~~

That is a live query against Keycloak's own schema, run as a user that did not exist a minute earlier.

Revoking the lease drops the role immediately:

~~~powershell
vault lease revoke database/creds/keycloak-readonly/GDqqrl...
~~~

~~~
psql: error: connection to server at "keycloak-db" (10.43.18.44), port 5432 failed:
FATAL:  password authentication failed for user "v-root-keycloak-PNllHaWWarkqyk6VlSVv-1794451806"
~~~

This is the difference between a secret and a credential. The password never appears in a ConfigMap, a Helm value, or a Git commit, and it stops existing on a timer you control.

## The failures that cost time

**Vault's UI runs OIDC in a popup.** Navigating the same tab to the callback URL produces `Cannot read properties of null (reading 'postMessage')`, because the callback page posts the token back to `window.opener`. If you are automating the flow, drive the popup, not the tab.

**A stale SPA route can look like a permission bug.** After logging in as the developer in a tab that previously held the admin session, the production page still rendered its path metadata. The API returned 403 the whole time. Always confirm authorization with a request, not with a page that may be showing cached shell state.

**One Vault page wedged the browser renderer.** The Access → Auth Methods welcome page hung `Page.captureScreenshot` for every page in that tab until it was closed. Reopening a fresh tab restored screenshots. Worth knowing before concluding the UI is broken.

**Traefik kept logging a missing secret.** Argo CD's ingress declared `argocd-server-tls` while the chart did not create it, so the route fell back to the default certificate and Traefik logged an error on every reconcile. Creating the secret from the lab CA fixed both the warning and the certificate consistency.

## What this lab proves and what it does not

Proved: OIDC login with a private CA, group claims reaching Vault as external identities, policy enforcement at the API, dynamic PostgreSQL credentials, and immediate revocation.

Not proved: availability. One Vault pod with Raft on a single Longhorn volume means an unseal after every restart and a full outage if that volume is lost. Keycloak being down also blocks every human login. There is no audit device enabled, which in a real deployment would be the first thing to add, because "who read `secret/prod/db`" is the question Vault exists to answer.

## Production checklist

- Run Vault with three Raft nodes, auto-unseal through a KMS or transit seal, and a real backup of the Raft snapshots.
- Enable at least one audit device before storing anything that matters.
- Replace the lab CA with a managed certificate and keep `oidc_discovery_ca_pem` only if the issuer is genuinely private.
- Give the database engine its own least-privilege PostgreSQL account. The `keycloak` superuser is convenient and wrong.
- Shorten `max_ttl` and require renewal for long-running consumers; five minutes is a demo value, not a policy.
- Add `bound_claims` for tenant or environment so a group alone is not sufficient for production access.
- Store the root token in a break-glass process, not in a file on the workstation.
- Decide whether Keycloak itself should fetch its database password from Vault at startup. That closes the loop, but it also makes Vault a hard dependency of the login path — a trade-off worth documenting before adopting it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `x509: certificate signed by unknown authority` during OIDC config | Vault cannot verify the issuer certificate | Supply `oidc_discovery_ca_pem` or use a trusted CA |
| `invalid_redirect_uri` after Keycloak login | Callback path does not match the client exactly | Register `/ui/vault/auth/oidc/oidc/callback` verbatim |
| Login succeeds, no permissions | Group claim and alias names disagree | Check `full.path` and the alias names |
| `Cannot read properties of null (reading 'postMessage')` | Callback opened in the same tab | Use the popup flow |
| Database config write fails | Connection string or admin credentials wrong | Test `psql` from a pod with the same values |
| Lease credentials stop working early | TTL expired or lease revoked | Re-read `database/creds/...` |

## Cleanup

~~~powershell
helm -n vault uninstall vault
kubectl delete namespace vault --ignore-not-found
~~~

Removing the namespace also removes the Raft volume, which means the unseal keys become useless. Export what you need first.

## Takeaways

SSO is only half of "Vault + Keycloak". The first half removes a password prompt; the second half removes a password. Keycloak answers who the human is, Vault decides what that identity can read, and the database engine makes sure the answer has an expiry. Keep the group claim and the policy file in sync, verify authorization with the API rather than the UI, and treat unseal keys and root tokens as the break-glass material they are.

## References

- [Vault: OIDC auth method](https://developer.hashicorp.com/vault/docs/auth/jwt)
- [Vault: External groups and aliases](https://developer.hashicorp.com/vault/docs/secrets/identity)
- [Vault: Database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases)
- [Vault: Kubernetes Helm chart](https://developer.hashicorp.com/vault/docs/platform/k8s/helm)
- [Keycloak: Server administration guide](https://www.keycloak.org/docs/latest/server_admin/)
