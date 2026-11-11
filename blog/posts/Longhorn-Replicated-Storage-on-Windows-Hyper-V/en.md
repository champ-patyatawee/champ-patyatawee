---
title: "Longhorn on Windows: A Four-Node k3s Lab on Hyper-V"
date: 2026-11-11
tags: [kubernetes, longhorn, k3s, hyper-v, storage, windows]
excerpt: "Longhorn needs open-iscsi on every node, so a container-based k3d cluster cannot host it. Here is a real four-node k3s lab on Hyper-V, with a PVC that survives pod rescheduling and a replica rebuilt from a surviving copy."
image: Longhorn-Replicated-Storage-on-Windows-Hyper-V/og.jpg
lang: en
---

The rest of this series runs on k3d: k3s inside Docker containers, four "nodes" that are really four containers on one machine. It is fast, disposable, and enough for Rancher, Vault, Trivy, and Fleet.

Longhorn is the first workload that does not fit. Longhorn is not an ordinary application that happens to store data. It turns each node into a piece of an iSCSI storage fabric: a target is exported from the node that owns the replica, the node that mounts the volume attaches to that target as an iSCSI initiator, and the kernel presents a block device to kubelet.

That requires `iscsiadm` and a running `iscsid` on the host, and it requires the host to see the block device the kernel creates. A k3d node container has none of that.

## Why k3d cannot run Longhorn

I checked every node in the existing lab before writing anything:

```bash
docker exec k3d-rancher-lab-agent-0 sh -c '
  for b in iscsiadm iscsid apk apt-get dnf; do
    printf "%s: " "$b"; (command -v $b || echo MISSING)
  done
  cat /etc/os-release
  mount | grep " /dev "'
```

```text
iscsiadm: MISSING
iscsid: MISSING
apk: MISSING
apt-get: MISSING
dnf: MISSING
PRETTY_NAME="K3s v1.36.5+k3s1"
tmpfs on /dev type tmpfs (rw,nosuid,size=65536k,mode=755)
```

Three separate problems, and only the first one is easy to see:

- The k3s node image is a minimal rootfs with busybox. There is no package manager, so `apt-get install open-iscsi` is not available.
- There is no `udev` inside the node, so the `/dev/disk/by-path/ip-...-lun-0` symlink that Longhorn resolves never appears.
- `/dev` is a 64 MiB tmpfs, not devtmpfs, so a LUN that the kernel discovers after an iSCSI login does not show up as a device node at all.

The Longhorn installation requirement is explicit about the first point: `open-iscsi` must be installed and `iscsid` must be running on **all** nodes, because Longhorn relies on `iscsiadm` on the host to provide persistent volumes. The k3d maintainers reached the same conclusion in [k3d discussion #478](https://github.com/k3d-io/k3d/discussions/478): the k3d image is bare bones and you cannot install open-iscsi into it.

I also tested the "just inject the binary" shortcut. Extracting Alpine's `open-iscsi 2.1.9` with its musl libraries and running it inside the k3s image does work:

```text
iscsiadm version 2.1.9
iscsid version 2.1.9
```

But a working binary does not fix the missing udev or the missing devtmpfs. Even if the initiator logs in, Longhorn still has no block device to attach. That is where the k3d route ends.

So the lab moves to real virtual machines. Not because VMs are trendy, but because Longhorn needs a kernel, udev, and a device filesystem that behave like a Linux host.

## What gets built

| Component | Version |
|---|---|
| Hypervisor | Hyper-V on Windows 10 Pro |
| Guest OS | Ubuntu 24.04.5 LTS cloud image |
| Kubernetes | k3s `v1.36.5+k3s1` |
| Storage | Longhorn chart `1.13.0` / app `v1.13.0` |
| Cluster shape | 1 server + 3 agents, 2 vCPU / 4 GiB / 25 GiB each |

The VMs sit on a private internal switch, `10.10.10.0/24`, with the Windows host as `10.10.10.1` and a Hyper-V NAT for outbound traffic. Bridging the Wi-Fi adapter would have been simpler on paper and flakier in practice.

The addresses are fixed: server `10.10.10.11`, agents `10.10.10.12`-`10.10.10.14`.

## Step 1: create the switch and the NAT

Run this in an elevated PowerShell. It creates an internal switch, gives the host an address on it, and adds NAT so the guests can reach the internet.

```powershell
New-VMSwitch -Name k3s-lab -SwitchType Internal
New-NetIPAddress -InterfaceAlias "vEthernet (k3s-lab)" -IPAddress 10.10.10.1 -PrefixLength 24
New-NetNat -Name k3s-lab-nat -InternalIPInterfaceAddressPrefix 10.10.10.0/24
```

`Get-NetNat` and `Get-VMSwitch` are the two commands worth checking afterwards; an existing NAT with an overlapping prefix is the usual reason the guests boot without connectivity.

## Step 2: turn the cloud image into a VHDX

Hyper-V cannot boot the qcow2 image that Ubuntu publishes, and Windows has no `qemu-img`. Docker does, so the conversion happens in a throwaway container and never touches the host.

```bash
docker run --rm -v D:\k3s-lab:/lab alpine:3.20 sh -c '
  apk add --no-cache qemu-img >/dev/null
  qemu-img convert -f qcow2 -O vhdx \
    /lab/images/noble-server-cloudimg-amd64.img \
    /lab/images/noble-base.vhdx'
```

The base disk is only 3.5 GiB. Each VM gets a copy, resized to 25 GiB with Hyper-V's own tooling before first boot:

```powershell
Copy-Item D:\k3s-lab\images\noble-base.vhdx D:\k3s-lab\vms\k3s-server\k3s-server.vhdx
Resize-VHD -Path D:\k3s-lab\vms\k3s-server\k3s-server.vhdx -SizeBytes 25GB
```

On boot, cloud-init runs `growpart` and the root filesystem expands into the new space.

## Step 3: build a cloud-init seed disk

The cloud image has no default password. Configuration arrives through a second disk labelled `CIDATA`, which cloud-init reads as the NoCloud datasource. The cleanest way to produce that disk on Windows is to format a small FAT image with `mtools` and convert it to VHDX, again inside a container:

```bash
dd if=/dev/zero of=seed.img bs=1M count=12 status=none
mkfs.vfat -n CIDATA seed.img
mcopy -i seed.img user-data ::user-data
mcopy -i seed.img meta-data ::meta-data
mcopy -i seed.img network-config ::network-config
qemu-img convert -f raw -O vhdx seed.img seed.vhdx
```

`user-data` carries the SSH key, the hostname, and the packages we want. The important part for a k3s node is the network configuration, because the VM has no DHCP server to talk to:

```yaml
version: 2
ethernets:
  eth0:
    match:
      name: "*"
    set-name: eth0
    dhcp4: false
    addresses: [10.10.10.11/24]
    routes:
      - to: default
        via: 10.10.10.1
    nameservers:
      addresses: [1.1.1.1, 8.8.8.8]
```

Two details are easy to get wrong. First, `match: {name: "en*"}` fails on this image, because Hyper-V gives the guest a plain `eth0`. Matching everything and forcing the name is more reliable. Second, put the same netplan document in `user-data` as a fallback, then remove `/etc/netplan/50-cloud-init.yaml` and run `netplan apply`, so the final state does not depend on the datasource having parsed `network-config` the way you expected.

## Step 4: create the VMs

```powershell
New-VM -Name k3s-server -Generation 2 -MemoryStartupBytes 4GB `
  -VHDPath D:\k3s-lab\vms\k3s-server\k3s-server.vhdx `
  -Path D:\k3s-lab\vms\k3s-server -SwitchName k3s-lab

Set-VMProcessor -VMName k3s-server -Count 2
Set-VMMemory -VMName k3s-server -DynamicMemoryEnabled $false
Set-VMFirmware -VMName k3s-server -EnableSecureBoot Off
Add-VMHardDiskDrive -VMName k3s-server -ControllerType SCSI -Path D:\k3s-lab\seed\k3s-server.vhdx
Start-VM -Name k3s-server
```

Generation 2 needs Secure Boot off, because the Ubuntu cloud image is not signed for the Microsoft UEFI template. Repeat for the three agents with their own disks, seed images, and addresses.

## Step 5: install k3s, and fix the DNS trap

This is where the first attempt failed, and the failure is worth keeping.

cloud-init brought the network up correctly, SSH worked, and the IP was right - but the package step died:

```text
E: Failed to fetch http://archive.ubuntu.com/ubuntu/... Temporary failure resolving 'archive.ubuntu.com'
```

The VM resolved names, but `getent hosts archive.ubuntu.com` returned only IPv6 addresses, and the NAT is IPv4-only. `apt` tried AAAA first and gave up. Two fixes make this deterministic:

```bash
# prefer IPv4 for name resolution and for apt
echo 'precedence ::ffff:0:0/96  100' | sudo tee -a /etc/gai.conf

sudo apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=8 update
sudo apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=8 install -y \
  open-iscsi nfs-common curl jq
sudo systemctl enable --now iscsid
sudo modprobe iscsi_tcp
```

Then install the server:

```bash
curl -sfL https://get.k3s.io -o /tmp/k3s-install.sh
sudo INSTALL_K3S_VERSION=v1.36.5+k3s1 \
  INSTALL_K3S_EXEC="server --write-kubeconfig-mode=644 \
    --tls-san=10.10.10.11 --node-ip=10.10.10.11 --flannel-iface=eth0" \
  sh /tmp/k3s-install.sh
```

and each agent, using the token from the server:

```bash
TOKEN=$(sudo cat /var/lib/rancher/k3s/server/node-token)

sudo K3S_URL=https://10.10.10.11:6443 K3S_TOKEN="$TOKEN" \
  INSTALL_K3S_VERSION=v1.36.5+k3s1 \
  INSTALL_K3S_EXEC="agent --node-ip=10.10.10.12 --flannel-iface=eth0" \
  sh /tmp/k3s-install.sh
```

The second DNS trap appears after the cluster is up. CoreDNS forwards to whatever is in `/etc/resolv.conf`, and on Ubuntu that is the `systemd-resolved` stub at `127.0.0.53`. Pods cannot reach that address, so every image pull in the cluster fails with `lookup registry-1.docker.io: Try again` even though `curl` on the node works fine. Disable the stub resolver on all four nodes:

```bash
sudo systemctl disable --now systemd-resolved
sudo rm -f /etc/resolv.conf
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' | sudo tee /etc/resolv.conf
```

Then restart CoreDNS, and the cluster can resolve registries:

```bash
kubectl -n kube-system rollout restart deploy/coredns
```

The result is the cluster Longhorn expects:

```text
NAME          STATUS   ROLES           AGE   VERSION        INTERNAL-IP
k3s-agent-0   Ready    <none>          85s   v1.36.5+k3s1   10.10.10.12
k3s-agent-1   Ready    <none>          72s   v1.36.5+k3s1   10.10.10.13
k3s-agent-2   Ready    <none>          59s   v1.36.5+k3s1   10.10.10.14
k3s-server    Ready    control-plane   18m   v1.36.5+k3s1   10.10.10.11
```

Copy the kubeconfig to Windows and rewrite the endpoint, because the file k3s writes points at `127.0.0.1`:

```powershell
ssh ubuntu@10.10.10.11 'sudo cat /etc/rancher/k3s/k3s.yaml' > C:\Users\C\.kube\k3s-lab.yaml
$c = Get-Content C:\Users\C\.kube\k3s-lab.yaml -Raw
$c -replace '127\.0\.0\.1','10.10.10.11' -replace 'default','k3s-lab' |
  Set-Content C:\Users\C\.kube\k3s-lab.yaml
```

## Step 6: install Longhorn

```bash
helm repo add longhorn https://charts.longhorn.io
helm repo update

helm install longhorn longhorn/longhorn \
  --namespace longhorn-system --create-namespace \
  --version 1.13.0 \
  --set defaultSettings.defaultReplicaCount=3
```

Every Longhorn node reports Ready and schedulable, and each one auto-creates a disk at `/var/lib/longhorn/`:

```bash
kubectl -n longhorn-system get nodes.longhorn.io
```

```text
NAME          READY   ALLOWSCHEDULING   SCHEDULABLE   AGE
k3s-agent-0   True    true              True          3m44s
k3s-agent-1   True    true              True          3m41s
k3s-agent-2   True    true              True          2m30s
k3s-server    True    true              True          3m41s
```

The dashboard below is the real UI from this cluster, reached with a port-forward:

```bash
kubectl -n longhorn-system port-forward svc/longhorn-frontend 8090:80
```

![Longhorn dashboard showing one healthy volume across four nodes](../image/blog/Longhorn-Replicated-Storage-on-Windows-Hyper-V/01-dashboard.png)

The nodes page matters more than the dashboard for this article. Each node contributes roughly 16 GiB of schedulable space, and the replica column is the thing to watch during the failure tests.

![Longhorn nodes with one replica on each of three nodes](../image/blog/Longhorn-Replicated-Storage-on-Windows-Hyper-V/02-nodes.png)

## Step 7: a volume with three replicas

The workload is deliberately boring: a single pod that appends a line every five seconds to a file on the PVC. A 2 GiB claim with the `longhorn` storage class is enough to show what happens when the pod moves and when a replica disappears.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: records
  namespace: longhorn-demo
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: longhorn
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: record-writer
  namespace: longhorn-demo
spec:
  replicas: 1
  selector:
    matchLabels: {app: record-writer}
  template:
    metadata:
      labels: {app: record-writer}
    spec:
      containers:
        - name: writer
          image: busybox:1.36
          command: ["/bin/sh","-c"]
          args:
            - while true; do
                echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) seq=$(cat /data/seq 2>/dev/null || echo 0)" >> /data/records.log;
                n=$(cat /data/seq 2>/dev/null || echo 0);
                echo $((n+1)) > /data/seq;
                sleep 5;
              done
          volumeMounts:
            - {name: data, mountPath: /data}
      volumes:
        - name: data
          persistentVolumeClaim: {claimName: records}
```

Once bound, Longhorn immediately places three replicas on three different nodes:

```text
NAME        STATE      ROBUSTNESS   SCHEDULED   SIZE
pvc-...     attached   healthy                  2147483648
```

![Volume detail with replicas on k3s-server, k3s-agent-0 and k3s-agent-1](../image/blog/Longhorn-Replicated-Storage-on-Windows-Hyper-V/04-volume-replicas.png)

## Step 8: prove the data survives a pod move

A replicated volume is only interesting if a reschedule is invisible to the application. Delete the pod and force it somewhere else:

```bash
kubectl -n longhorn-demo delete pod -l app=record-writer
kubectl -n longhorn-demo get pod -o wide
```

The replacement landed on `k3s-server`, while the volume had been attached to `k3s-agent-1`. Longhorn detached the engine from the old node, attached it to the new one, and the container found the same filesystem:

```text
NAME                             READY   STATUS    NODE
record-writer-7c58c7465c-7gxdc   1/1     Running   k3s-server
```

```text
434 /data/records.log
2026-11-11T09:53:39Z seq=0
2026-11-11T09:53:44Z seq=1
2026-11-11T10:30:57Z seq=433
```

The sequence does not restart at zero. The file that began on one node continues on another, with an 80-second gap while the volume detached and reattached.

## Step 9: break a replica and watch it rebuild

To make the rebuild observable, first write 600 MiB of random data into the volume. With a nearly empty filesystem the rebuild finishes in a second and there is nothing to see in the UI.

```bash
kubectl -n longhorn-demo exec deploy/record-writer -- \
  dd if=/dev/urandom of=/data/blob.bin bs=1M count=600
```

Then delete one replica. Longhorn recreates it and syncs from the surviving copies:

```bash
kubectl -n longhorn-system delete replicas.longhorn.io \
  pvc-f605ff63-4ce1-4c4c-8fe6-d613d1484a15-r-095957c8
```

The volume drops to `Degraded` while the new replica catches up:

![Volume degraded while a replacement replica rebuilds](../image/blog/Longhorn-Replicated-Storage-on-Windows-Hyper-V/05-replica-rebuilding.png)

The yellow card is the new replica, on a different node, with a live progress bar. When it finishes, the volume returns to three healthy replicas and the writer never noticed:

```text
NAME        STATE      ROBUSTNESS
pvc-...     attached   healthy
```

![Healthy volume after the replica rebuild](../image/blog/Longhorn-Replicated-Storage-on-Windows-Hyper-V/06-healthy-after-rebuild.png)

```text
NAME                    NODE          STATE
pvc-...-r-20211b83      k3s-server    running
pvc-...-r-22135a8d      k3s-agent-0   running
pvc-...-r-be9bf363      k3s-agent-1   running
```

## The image-pull problem worth knowing about

One failure deserves its own note because it will happen to anyone on a slow or unstable link. After the DNS fix, some Longhorn images still would not pull. kubelet backs off up to five minutes between attempts, so a flaky download keeps the pod in `ImagePullBackOff` long after the registry is reachable again.

The reliable workaround is to stop pulling from the registry four times and distribute one copy instead. On a node that has the image:

```bash
sudo k3s ctr images export /tmp/im.tar \
  docker.io/longhornio/longhorn-instance-manager:v1.13.0
```

Copy the tarball to the other nodes over the internal switch, then:

```bash
sudo k3s ctr images import /tmp/im.tar
kubectl -n longhorn-system delete pod --field-selector=status.phase!=Running
```

This is a lab convenience, not a production pattern. In a real cluster you would use a registry mirror, a pull-through cache, or pre-baked node images.

## What this lab does and does not prove

It proves the parts that are hard to fake: three replicas on three different nodes, a pod rescheduled to a different host with its data intact, and a deleted replica rebuilt from the surviving copies while the application kept writing.

It does not make this production storage. The gaps are concrete:

- One physical host. If it dies, all four VMs die; Longhorn's replication is protecting against node loss, not against hypervisor loss.
- 25 GiB per node with about 16 GiB schedulable. Longhorn reserves space and refuses to over-schedule, so capacity planning still matters.
- No backup target. Snapshots are local to the cluster; without an S3 or NFS target there is no copy that survives the cluster.
- NAT and a private switch on the hypervisor. There is no high availability for the network path.
- The VMs are single-disk. Longhorn is using a filesystem disk, not a dedicated block device, which is fine for a lab and not how you would size a production node.

For production, the checklist is different: at least three separate physical hosts, dedicated disks per node, a tested backup target, alerting on volume robustness, and a documented procedure for draining a node that hosts replicas.

## Cleanup

Remove the workload, then Longhorn, then the VMs and the network:

```bash
kubectl delete namespace longhorn-demo
helm uninstall longhorn -n longhorn-system
kubectl delete namespace longhorn-system
```

```powershell
Get-VM k3s-* | Stop-VM -TurnOff
Get-VM k3s-* | Remove-VM
Remove-Item D:\k3s-lab -Recurse

Remove-NetNat -Name k3s-lab-nat
Remove-VMSwitch -Name k3s-lab
```

## Takeaways

- Longhorn is host-level storage. The initiator, udev, and device nodes must exist on the node, not inside a container.
- k3d is an excellent lab for control-plane work and the wrong tool for storage plugins that need real kernel and device visibility.
- Ubuntu's `systemd-resolved` stub breaks CoreDNS in a k3s cluster unless you replace `/etc/resolv.conf`, and it fails in a way that looks like a registry outage.
- Replication is only credible when you delete something. A replica rebuild with a visible progress bar and an application that keeps writing is better evidence than a green status icon.

## References

- [Longhorn installation requirements](https://longhorn.io/docs/latest/deploy/install/)
- [Longhorn 1.13 documentation](https://longhorn.io/docs/1.13.0/)
- [k3d discussion #478: Using Longhorn in k3d](https://github.com/k3d-io/k3d/discussions/478)
- [k3s discussion #9987: iscsiadm / open-iscsi setup](https://github.com/k3s-io/k3s/discussions/9987)
- [Ubuntu cloud images](https://cloud-images.ubuntu.com/noble/current/)
