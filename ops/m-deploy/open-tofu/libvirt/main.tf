provider "libvirt" {}

locals {
  nodes = { for node in var.topology.nodes : node.nodeId => node }
}

# 默认只校验 M-Deploy 生成的变量和 module shape。实际 VM 创建必须由本地操作员显式启用。
resource "libvirt_network" "meristem" {
  count      = var.enable_libvirt_resources ? 1 : 0
  name       = var.topology.network.networkId
  mode       = "nat"
  addresses  = [var.topology.network.cidr]
  autostart  = true
}

resource "libvirt_volume" "node_root" {
  for_each       = var.enable_libvirt_resources ? local.nodes : {}
  name           = "${var.topology.topologyId}-${each.key}.qcow2"
  pool           = var.storage_pool
  base_volume_id = var.base_volume_id
  size           = each.value.resources.diskGiB * 1024 * 1024 * 1024
  format         = "qcow2"
}

resource "libvirt_domain" "node" {
  for_each = var.enable_libvirt_resources ? local.nodes : {}

  name   = "${var.topology.topologyId}-${each.key}"
  memory = each.value.resources.memoryMiB
  vcpu   = each.value.resources.vcpu

  disk {
    volume_id = libvirt_volume.node_root[each.key].id
  }

  network_interface {
    network_id = libvirt_network.meristem[0].id
  }
}
