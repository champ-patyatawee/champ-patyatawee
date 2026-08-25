---
title: "How to Install Vault and the External Secrets Operator on Kubernetes"
date: 2026-08-20
tags: [vault, hashicorp, kubernetes, external-secrets, devops]
excerpt: "HashiCorp Vault stores secrets in one place with policies, and the External Secrets Operator pulls them into Kubernetes as native Secrets."
image: Vault-External-Secrets-Operator/og-image.jpg
lang: en
---

HashiCorp Vault is a tool for storing and controlling access to secrets. API keys, database passwords, and certificates all live in one place, and policies decide who can read what.

The External Secrets Operator (ESO) is a Kubernetes controller that pulls secrets from tools like Vault and turns them into native Kubernetes `Secret`s. You declare what to sync in a couple of YAML resources, and the operator keeps them updated.

This article installs both on Kubernetes and wires them together.

# Install Vault with Helm (Production)

Add the HashiCorp repo and pull the default values so you can see every option:

```bash
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update
helm show values hashicorp/vault > values.yaml
```

The chart default is a single standalone server with file storage. That is not production. Production means HA mode with Integrated Storage (Raft), a StatefulSet, and persistent volumes. Here is the `values.yaml` I use:

```yaml
# values.yaml
server:
  standalone:
    enabled: false
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true
      setNodeId: true
      config: |
        ui = true
        listener "tcp" {
          address = "[::]:8200"
          cluster_address = "[::]:8201"
        }
        storage "raft" {
          path = "/vault/data"
          retry_join {
            leader_api_addr = "https://vault-0.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "https://vault-1.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "https://vault-2.vault-internal:8200"
          }
        }
  dataStorage:
    enabled: true
    size: 10Gi
  auditStorage:
    enabled: true
ui:
  enabled: true
```

Install the latest chart (0.34.0 as of this writing) with your values file:

```bash
helm install vault hashicorp/vault -n vault --create-namespace -f values.yaml
kubectl get pods -n vault
```

The chart sets up the StatefulSet, but it does not operate Vault for you. You still have to initialize and unseal it:

```bash
kubectl exec -n vault vault-0 -- vault operator init \
  -key-shares=5 -key-threshold=3
kubectl exec -n vault vault-0 -- vault operator unseal <key-1>
kubectl exec -n vault vault-0 -- vault operator unseal <key-2>
kubectl exec -n vault vault-0 -- vault operator unseal <key-3>
```

Write down the unseal keys and root token, then unseal `vault-1` and `vault-2` the same way.

Two things HashiCorp pushes hard that I left out to keep this focused: TLS (the chart serves plain HTTP by default) and auto-unseal via a cloud KMS so pods unseal themselves after reschedules. Add both before this touches anything real. ESO will talk to Vault at `http://vault:8200` in the cluster.
