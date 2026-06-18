{ config, lib, pkgs, ... }:

let
  cfg = config.services.meristemNodeAgent;

  launcher = pkgs.writeShellScript "meristem-node-agent-launcher" ''
    set -euo pipefail

    if [ -z "''${MERISTEM_JOIN_TICKET:-}" ] && [ -r "$MERISTEM_NODE_AGENT_JOIN_TICKET_FILE" ]; then
      export MERISTEM_JOIN_TICKET="$(tr -d '\n' < "$MERISTEM_NODE_AGENT_JOIN_TICKET_FILE")"
    fi

    if [ -z "''${MERISTEM_NODE_ID:-}" ] && [ -r "$MERISTEM_NODE_AGENT_NODE_ID_FILE" ]; then
      export MERISTEM_NODE_ID="$(tr -d '\n' < "$MERISTEM_NODE_AGENT_NODE_ID_FILE")"
    fi

    if [ -z "''${MERISTEM_NODE_TOKEN:-}" ] && [ -r "$MERISTEM_NODE_AGENT_RUNTIME_TOKEN_FILE" ]; then
      export MERISTEM_NODE_TOKEN="$(tr -d '\n' < "$MERISTEM_NODE_AGENT_RUNTIME_TOKEN_FILE")"
    fi

    exec ${cfg.bunPackage}/bin/bun run ${cfg.serviceCommand}
  '';

  preflight = pkgs.writeShellScript "meristem-node-agent-preflight" ''
    set -euo pipefail

    WG_PATH="''${MERISTEM_WG_BINARY_PATH:-wg}"

    if ! command -v "$WG_PATH" >/dev/null 2>&1; then
      printf 'meristem-node-agent preflight failed: wg binary not found at %s\n' "$WG_PATH" >&2
      exit 1
    fi

    if ! "$WG_PATH" --version >/dev/null 2>&1; then
      printf 'meristem-node-agent preflight failed: wg --version returned non-zero\n' >&2
      exit 1
    fi

    if [ ! -d /sys/module/wireguard ]; then
      printf 'meristem-node-agent preflight failed: /sys/module/wireguard is missing\n' >&2
      exit 1
    fi

    if ! ${pkgs.iproute2}/bin/ip link add dev meristem-preflight type wireguard >/dev/null 2>&1; then
      printf 'meristem-node-agent preflight failed: CAP_NET_ADMIN or WireGuard device creation is unavailable\n' >&2
      exit 1
    fi

    ${pkgs.iproute2}/bin/ip link delete meristem-preflight >/dev/null 2>&1 || true
  '';
in
{
  options.services.meristemNodeAgent = {
    enable = lib.mkEnableOption "Meristem node-agent NixOS module";

    workspaceDir = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "/srv/meristem";
      description = "Meristem checkout used to execute the Bun node-agent runtime.";
    };

    serviceCommand = lib.mkOption {
      type = lib.types.str;
      default = "services/node-agent/src/index.ts";
      description = "Bun entrypoint for the node-agent runtime.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/node-agent.env";
      description = "Environment file loaded by the node-agent systemd unit.";
    };

    configDir = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent";
      description = "Configuration directory for node-agent files such as env, join ticket, and runtime token.";
    };

    nodeRole = lib.mkOption {
      type = lib.types.enum [ "stem" "leaf" ];
      default = "leaf";
      description = "Declared node-agent role used by the profile template.";
    };

    nodeName = lib.mkOption {
      type = lib.types.str;
      default = "local-leaf";
      description = "Default node name placed in the generated env file.";
    };

    joinUrl = lib.mkOption {
      type = lib.types.str;
      default = "wss://control-plane.example.com:8443/join/v0/session";
      description = "Join ingress URL consumed by the node-agent runtime.";
    };

    relayEndpoint = lib.mkOption {
      type = lib.types.str;
      default = "wss://relay.control-plane.example.com:443";
      description = "Pinned relay endpoint advertised to the node-agent for fallback transport.";
    };

    acmeDirectory = lib.mkOption {
      type = lib.types.str;
      default = "https://acme-v02.api.letsencrypt.org/directory";
      description = "ACME directory URL exposed to the node-agent runtime.";
    };

    wgBinaryPath = lib.mkOption {
      type = lib.types.str;
      default = "${pkgs.wireguard-tools}/bin/wg";
      description = "WireGuard binary path used by preflight and runtime env generation.";
    };

    wstunnelBinaryPath = lib.mkOption {
      type = lib.types.str;
      default = "/run/current-system/sw/bin/wstunnel";
      description = "wstunnel binary path exposed to the node-agent runtime.";
    };

    acmeAccountKeyPath = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/tls/account.key";
      description = "Host-local ACME account key path.";
    };

    joinTicketFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/join-ticket";
      description = "File read by the launcher when MERISTEM_JOIN_TICKET is absent from the environment.";
    };

    nodeIdFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/node-id";
      description = "File read by the launcher when MERISTEM_NODE_ID is absent from the environment.";
    };

    runtimeTokenFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/runtime-token";
      description = "File read by the launcher when MERISTEM_NODE_TOKEN is absent from the environment.";
    };

    wgPrivateKeyPath = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/node-agent/wg/private.key";
      description = "Host-local WireGuard private key file path.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "meristem-node-agent";
      description = "System user that runs the node-agent service.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "meristem-node-agent";
      description = "System group that runs the node-agent service.";
    };

    bunPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.bun;
      description = "Bun package used to execute the node-agent runtime.";
    };

    extraEnvironment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Additional environment variables merged into the systemd unit.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.workspaceDir != "";
        message = "services.meristemNodeAgent.workspaceDir must point at a Meristem checkout.";
      }
    ];

    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      inherit (cfg) group;
      home = cfg.workspaceDir;
      createHome = false;
    };

    environment.etc = {
      "meristem/node-agent/node-agent.env".text = ''
        MERISTEM_JOIN_URL=${cfg.joinUrl}
        MERISTEM_AGENT_VERSION=0.1.0
        MERISTEM_WG_BINARY_PATH=${cfg.wgBinaryPath}
        MERISTEM_WSTUNNEL_BINARY_PATH=${cfg.wstunnelBinaryPath}
        MERISTEM_ACME_DIRECTORY=${cfg.acmeDirectory}
        MERISTEM_ACME_ACCOUNT_KEY=${cfg.acmeAccountKeyPath}
        MERISTEM_HOST_PRIVATE_KEY_PATH=${cfg.wgPrivateKeyPath}
        MERISTEM_RELAY_ENDPOINT=${cfg.relayEndpoint}
        MERISTEM_LOG_LEVEL=info
        MERISTEM_NODE_AGENT_ROLE=${cfg.nodeRole}
        MERISTEM_NODE_AGENT_NAME=${cfg.nodeName}
      '';
      "meristem/node-agent/join-ticket".text = "";
      "meristem/node-agent/node-id".text = "";
      "meristem/node-agent/runtime-token".text = "";
    };

    systemd.tmpfiles.rules = [
      "d ${cfg.configDir} 0750 root ${cfg.group} - -"
      "d ${cfg.configDir}/tls 0750 root ${cfg.group} - -"
      "d ${cfg.configDir}/wg 0750 root ${cfg.group} - -"
    ];

    systemd.services.meristem-node-agent = {
      description = "Meristem node-agent";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        MERISTEM_NODE_AGENT_CONFIG_DIR = cfg.configDir;
        MERISTEM_NODE_AGENT_JOIN_TICKET_FILE = cfg.joinTicketFile;
        MERISTEM_NODE_AGENT_NODE_ID_FILE = cfg.nodeIdFile;
        MERISTEM_NODE_AGENT_RUNTIME_TOKEN_FILE = cfg.runtimeTokenFile;
      } // cfg.extraEnvironment;
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.workspaceDir;
        EnvironmentFile = cfg.environmentFile;
        ExecStartPre = [ preflight ];
        ExecStart = launcher;
        Restart = "on-failure";
        RestartSec = 2;
        NoNewPrivileges = true;
        AmbientCapabilities = [ "CAP_NET_ADMIN" ];
        CapabilityBoundingSet = [ "CAP_NET_ADMIN" ];
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadOnlyPaths = [ cfg.workspaceDir cfg.configDir ];
      };
    };
  };
}
