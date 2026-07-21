---
title: "Hello, World! — First Blog Post"
date: 2025-07-15
tags: [devops, personal]
excerpt: "Welcome to my new blog! I'm kicking things off with a quick introduction about what you can expect — DevOps deep-dives, cloud architecture insights, and lessons from the trenches."
---

After years of telling myself "I should start a blog," I'm finally doing it. Welcome to my little corner of the internet where I'll be sharing thoughts, tutorials, and hard-won lessons from the world of DevOps and cloud infrastructure.

## Why Start a Blog?

For the longest time, I've been consuming — reading docs, watching conference talks, debugging cryptic error messages at 2 AM. It's time to give back. Here's what you can expect:

- **Practical guides** — Step-by-step walkthroughs of real infrastructure setups
- **War stories** — Things that broke, how I fixed them, and what I learned
- **Best practices** — Patterns that have worked (and some that haven't)
- **Tools & reviews** — Honest takes on the tools I use daily

> "The only way to learn is by doing. The only way to teach is by showing." — Someone wise, probably

## What I Do

I'm a DevOps & Cloud Infrastructure Engineer based in Thailand. My day-to-day involves:

1. Designing and managing Kubernetes clusters across multiple cloud providers
2. Building CI/CD pipelines that developers actually enjoy using
3. Implementing GitOps workflows with ArgoCD and Flux
4. Writing Infrastructure as Code with Terraform and Pulumi

### A Quick Code Sample

Here's a simple example of the kind of automation I deal with regularly:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: blog-demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-world
  namespace: blog-demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hello-world
  template:
    metadata:
      labels:
        app: hello-world
    spec:
      containers:
        - name: app
          image: nginx:alpine
          ports:
            - containerPort: 80
```

And some `inline code` for good measure — like `kubectl get pods -n blog-demo`.

## What's Next?

I'm planning to post roughly every two weeks. Topics will range from foundational concepts to advanced production patterns. If there's something specific you'd like me to cover, feel free to reach out.

Thanks for reading, and happy building! 🚀
