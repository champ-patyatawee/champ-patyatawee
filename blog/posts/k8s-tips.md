---
title: "5 Kubernetes Tips for Production Clusters"
date: 2025-07-10
tags: [kubernetes, devops, production, tips]
excerpt: "After managing Kubernetes clusters in production for over 5 years, here are five practical tips that have saved my teams countless hours of debugging and downtime."
---

Running Kubernetes in production is a very different beast from spinning up a cluster on Minikube. After managing production clusters for over 5 years across AWS EKS, GCP GKE, and Azure AKS, here are five tips that have genuinely saved my teams from disaster.

## 1. Set Resource Limits (and Requests) on Everything

This might seem obvious, but you'd be surprised how many clusters I've seen where critical workloads have no resource constraints. **Always** set both `requests` and `limits`.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-demo
spec:
  containers:
    - name: app
      image: my-app:latest
      resources:
        requests:
          memory: "256Mi"
          cpu: "250m"
        limits:
          memory: "512Mi"
          cpu: "500m"
```

Without limits, a single noisy pod can starve the entire node. Without requests, the scheduler can't make intelligent placement decisions.

> **Pro tip**: Use the `VPA` (Vertical Pod Autoscaler) in recommendation mode to gather data on actual usage before setting requests and limits in production.

## 2. Implement Proper Pod Disruption Budgets (PDBs)

If you're doing rolling updates, node maintenance, or cluster upgrades without PDBs, you're one `kubectl drain` away from downtime.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: my-app
```

This ensures at least 2 replicas of `my-app` remain available during voluntary disruptions. For critical services, I recommend `minAvailable` over `maxUnavailable` — it's more intuitive and safer.

## 3. Use Network Policies by Default

By default, Kubernetes allows all pod-to-pod communication. In production, this is a security nightmare. Start with a **default-deny** policy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Then selectively open up access as needed. This defense-in-depth approach has prevented multiple potential security incidents in my experience.

## 4. Monitor the Control Plane (Even on Managed K8s)

Just because you're on EKS, GKE, or AKS doesn't mean you can ignore the control plane. Set up alerts for:

1. **API server latency** — Spikes often indicate misconfigured controllers or runaway clients
2. **etcd leader changes** — Frequent changes signal underlying node issues
3. **Certificate expiration** — Expired certs will silently break your cluster
4. **Node conditions** — `NodeHasDiskPressure`, `NodeHasMemoryPressure`, etc.

Most teams set up pod-level monitoring but forget the control plane. Don't be that team.

## 5. Use Kyverno or OPA/Gatekeeper for Policy Enforcement

Relying on "trust everyone to do the right thing" doesn't scale. Use policy-as-code to enforce best practices automatically:

- **Require** resource limits on all pods
- **Deny** containers running as root
- **Ensure** all images come from approved registries
- **Enforce** consistent label schemas

Here's a Kyverno policy that ensures no container runs as root:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-root-user
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-root-user
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Running as root is not allowed."
        pattern:
          spec:
            securityContext:
              runAsNonRoot: true
```

## Wrapping Up

Kubernetes is incredibly powerful, but with great power comes great responsibility. These five practices have been battle-tested across dozens of production clusters, and I'm confident they'll save you headaches too.

What are your go-to production tips? I'd love to hear them — reach out on [LinkedIn](https://www.linkedin.com/in/ChampPatyatawee/) or check out my [GitHub](https://github.com/champ-patyatawee) for more.
