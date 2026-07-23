variable "schemaVersion" {
  type = string

  validation {
    condition     = var.schemaVersion == "mdeploy.opentofu-module-input@0.1.0"
    error_message = "M-Deploy OpenTofu input schema version is unsupported."
  }
}

variable "topology" {
  type = object({
    topologyId = string
    revision   = string
    network = object({
      networkId = string
      cidr      = string
    })
    nodes = list(object({
      nodeId        = string
      workloadClass = string
      failureDomain = string
      resources = object({
        vcpu      = number
        memoryMiB = number
        diskGiB   = number
      })
      runtimeDriver = string
    }))
  })

  validation {
    condition     = length(var.topology.nodes) == 8
    error_message = "The validation fixture requires exactly eight nodes."
  }

  validation {
    condition = alltrue([
      for node in var.topology.nodes :
      node.runtimeDriver == "podman" && node.resources.vcpu > 0 && node.resources.memoryMiB > 0 && node.resources.diskGiB > 0
    ])
    error_message = "Every fixture node requires positive resources and the Podman production runtime."
  }
}

variable "enable_libvirt_resources" {
  type        = bool
  default     = false
  description = "Explicitly enables libvirt resource creation after operator-provided host prerequisites are available."
}

variable "base_volume_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Existing bootable libvirt volume used only when resource creation is enabled."

  validation {
    condition     = !var.enable_libvirt_resources || var.base_volume_id != null
    error_message = "base_volume_id is required when enable_libvirt_resources is true."
  }
}

variable "storage_pool" {
  type    = string
  default = "default"
}
