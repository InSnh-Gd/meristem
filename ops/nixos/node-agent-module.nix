{ config, lib, pkgs, ... }:

let
  cfg = config.services.meristemNodeAgent;
  deploymentConfigPath = "/etc/meristem/node-agent/deployment-v02.json";
  mkSecretRef =
    keyPath:
    if keyPath == null then
      null
    else
      {
        provider = cfg.secrets.providerName;
        inherit keyPath;
      };
  deploymentV02Config = {
    track = "nixos";
    serviceUrls = {
      core = cfg.controlPlane.coreUrl;
      mnet = cfg.controlPlane.mnetUrl;
      policy = cfg.controlPlane.policyUrl;
      log = cfg.controlPlane.logUrl;
      eventbus = cfg.controlPlane.eventbusUrl;
      task = cfg.controlPlane.taskUrl;
      extension = cfg.controlPlane.extensionUrl;
      uiBff = cfg.controlPlane.uiBffUrl;
      nodeAgent = cfg.controlPlane.nodeAgentUrl;
    };
    internalAuth = {
      headerName = cfg.controlPlane.internalAuth.headerName;
      tokenEnvVar = cfg.controlPlane.internalAuth.tokenEnvVar;
    }
    // lib.optionalAttrs (cfg.controlPlane.internalAuth.tokenSecretRef != null) {
      tokenSecretRef = mkSecretRef cfg.controlPlane.internalAuth.tokenSecretRef;
    };
    oidc = {
      provider = "oidc";
      issuer = cfg.controlPlane.oidc.issuer;
      audiences = cfg.controlPlane.oidc.audiences;
      allowedAlgorithms = cfg.controlPlane.oidc.allowedAlgorithms;
      jwksCache = {
        refreshIntervalMs = cfg.controlPlane.oidc.jwksCache.refreshIntervalMs;
        ttlMs = cfg.controlPlane.oidc.jwksCache.ttlMs;
      };
      clockToleranceSeconds = cfg.controlPlane.oidc.clockToleranceSeconds;
    }
    // lib.optionalAttrs (cfg.controlPlane.oidc.discoveryUrl != null) {
      discoveryUrl = cfg.controlPlane.oidc.discoveryUrl;
    };
    secretProvider = {
      providerName = cfg.secrets.providerName;
      backend = cfg.secrets.providerBackend;
      namedProvider = {
        name = cfg.secrets.providerName;
        config =
          if cfg.secrets.providerBackend == "local-dev-env" then
            {
              backend = "local-dev-env";
              envMappings = cfg.secrets.localDevEnvMappings;
            }
          else
            {
              backend = "vault-kv-v2";
              address = cfg.secrets.vault.address;
              mountPath = cfg.secrets.vault.mountPath;
              authMethodRef = cfg.secrets.vault.authMethodRef;
            };
      }
      // lib.optionalAttrs (cfg.secrets.cache.freshTtlMs != null && cfg.secrets.cache.staleTtlMs != null) {
        cache = {
          freshTtlMs = cfg.secrets.cache.freshTtlMs;
          staleTtlMs = cfg.secrets.cache.staleTtlMs;
        };
      };
    };
    secretBindings = builtins.filter (binding: binding != null) [
      (if cfg.controlPlane.internalAuth.tokenSecretRef == null then
        null
      else
        {
          envVar = cfg.controlPlane.internalAuth.tokenEnvVar;
          ref = mkSecretRef cfg.controlPlane.internalAuth.tokenSecretRef;
        })
      (if cfg.secrets.netbird.signalCredentialRef == null then
        null
      else
        {
          envVar = "MERISTEM_NETBIRD_SIGNAL_CREDENTIAL";
          ref = mkSecretRef cfg.secrets.netbird.signalCredentialRef;
        })
      (if cfg.secrets.netbird.relayCredentialRef == null then
        null
      else
        {
          envVar = "MERISTEM_NETBIRD_RELAY_CREDENTIAL";
          ref = mkSecretRef cfg.secrets.netbird.relayCredentialRef;
        })
      (if cfg.secrets.netbird.stunCredentialRef == null then
        null
      else
        {
          envVar = "MERISTEM_NETBIRD_STUN_CREDENTIAL";
          ref = mkSecretRef cfg.secrets.netbird.stunCredentialRef;
        })
      (if cfg.secrets.sidecar.authTokenRef == null then
        null
      else
        {
          envVar = "MERISTEM_SIDECAR_AUTH_TOKEN";
          ref = mkSecretRef cfg.secrets.sidecar.authTokenRef;
        })
      (if cfg.secrets.sidecar.configSecretRef == null then
        null
      else
        {
          envVar = "MERISTEM_SIDECAR_CONFIG_SECRET";
          ref = mkSecretRef cfg.secrets.sidecar.configSecretRef;
        })
    ];
    netbird = cfg.netbird;
    nodeAgentCapabilities = {
      netAdmin = cfg.capabilities.netAdmin;
      wireguardModulePath = cfg.capabilities.wireguardModulePath;
      wgBinaryPath = cfg.wgBinaryPath;
      ipBinaryPath = cfg.capabilities.ipBinaryPath;
      wstunnelBinaryPath = cfg.wstunnelBinaryPath;
    };
    readiness = {
      postgres = {
        kind = "postgres-select-1";
        target = "postgres";
      };
      core = {
        kind = "http-get";
        target = "core";
        endpoint = "${cfg.controlPlane.coreUrl}/api/v0/ready";
      };
      mnet = {
        kind = "http-get";
        target = "m-net";
        endpoint = "${cfg.controlPlane.mnetUrl}/ready";
      };
      policy = {
        kind = "http-get";
        target = "m-policy";
        endpoint = "${cfg.controlPlane.policyUrl}/ready";
      };
      log = {
        kind = "http-get";
        target = "m-log";
        endpoint = "${cfg.controlPlane.logUrl}/ready";
      };
      eventbus = {
        kind = "http-get";
        target = "m-eventbus";
        endpoint = "${cfg.controlPlane.eventbusUrl}/ready";
      };
      task = {
        kind = "http-get";
        target = "m-task";
        endpoint = "${cfg.controlPlane.taskUrl}/health";
      };
      extension = {
        kind = "http-get";
        target = "m-extension";
        endpoint = "${cfg.controlPlane.extensionUrl}/ready";
      };
      uiBff = {
        kind = "http-get";
        target = "m-ui-bff";
        endpoint = "${cfg.controlPlane.uiBffUrl}/ready";
      };
      nodeAgent = {
        kind = "command";
        target = "node-agent";
        command = [ "systemctl" "is-active" "meristem-node-agent.service" ];
      };
    };
  };
  secretRefEnvironment =
    {
      MERISTEM_SECRET_PROVIDER_NAME = cfg.secrets.providerName;
      MERISTEM_SECRET_PROVIDER_BACKEND = cfg.secrets.providerBackend;
      MERISTEM_V02_DEPLOYMENT_CONFIG = deploymentConfigPath;
    }
    // lib.optionalAttrs (cfg.secrets.vault.address != "") {
      MERISTEM_SECRET_PROVIDER_VAULT_ADDRESS = cfg.secrets.vault.address;
    }
    // lib.optionalAttrs (cfg.secrets.vault.mountPath != "") {
      MERISTEM_SECRET_PROVIDER_VAULT_MOUNT_PATH = cfg.secrets.vault.mountPath;
    }
    // lib.optionalAttrs (cfg.secrets.vault.authMethodRef != "") {
      MERISTEM_SECRET_PROVIDER_VAULT_AUTH_METHOD_REF = cfg.secrets.vault.authMethodRef;
    }
    // lib.optionalAttrs (cfg.secrets.netbird.signalCredentialRef != null) {
      MERISTEM_NETBIRD_SIGNAL_CREDENTIAL_REF = cfg.secrets.netbird.signalCredentialRef;
    }
    // lib.optionalAttrs (cfg.secrets.netbird.relayCredentialRef != null) {
      MERISTEM_NETBIRD_RELAY_CREDENTIAL_REF = cfg.secrets.netbird.relayCredentialRef;
    }
    // lib.optionalAttrs (cfg.secrets.netbird.stunCredentialRef != null) {
      MERISTEM_NETBIRD_STUN_CREDENTIAL_REF = cfg.secrets.netbird.stunCredentialRef;
    }
    // lib.optionalAttrs (cfg.secrets.sidecar.authTokenRef != null) {
      MERISTEM_SIDECAR_AUTH_TOKEN_REF = cfg.secrets.sidecar.authTokenRef;
    }
    // lib.optionalAttrs (cfg.secrets.sidecar.configSecretRef != null) {
      MERISTEM_SIDECAR_CONFIG_SECRET_REF = cfg.secrets.sidecar.configSecretRef;
    };

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

    capabilities = {
      netAdmin = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether node-agent hosts are expected to provide CAP_NET_ADMIN.";
      };

      wireguardModulePath = lib.mkOption {
        type = lib.types.str;
        default = "/sys/module/wireguard";
        description = "WireGuard kernel module path required by node-agent preflight.";
      };

      ipBinaryPath = lib.mkOption {
        type = lib.types.str;
        default = "${pkgs.iproute2}/bin/ip";
        description = "iproute2 binary path required by node-agent preflight and runtime application.";
      };
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

    controlPlane = {
      coreUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3000";
        description = "Core URL advertised by the node-agent deployment wrapper.";
      };

      mnetUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3104";
        description = "M-Net URL advertised by the node-agent deployment wrapper.";
      };

      policyUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3101";
        description = "M-Policy URL advertised by the node-agent deployment wrapper.";
      };

      logUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3102";
        description = "M-Log URL advertised by the node-agent deployment wrapper.";
      };

      eventbusUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3103";
        description = "M-EventBus URL advertised by the node-agent deployment wrapper.";
      };

      taskUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3105";
        description = "M-Task URL advertised by the node-agent deployment wrapper.";
      };

      extensionUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3106";
        description = "M-Extension URL advertised by the node-agent deployment wrapper.";
      };

      uiBffUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3200";
        description = "M-UI BFF URL advertised by the node-agent deployment wrapper.";
      };

      nodeAgentUrl = lib.mkOption {
        type = lib.types.str;
        default = "http://127.0.0.1:3307";
        description = "Node-agent self-reference URL advertised by the deployment wrapper.";
      };

      internalAuth = {
        headerName = lib.mkOption {
          type = lib.types.str;
          default = "x-meristem-internal-token";
          description = "Internal auth header name advertised by the node-agent deployment wrapper.";
        };

        tokenEnvVar = lib.mkOption {
          type = lib.types.str;
          default = "MERISTEM_INTERNAL_TOKEN";
          description = "Internal auth token env var advertised by the node-agent deployment wrapper.";
        };

        tokenSecretRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef keyPath for the control-plane internal auth token metadata.";
        };
      };

      oidc = {
        issuer = lib.mkOption {
          type = lib.types.str;
          default = "https://identity.control-plane.example.com";
          description = "OIDC issuer advertised by the node-agent deployment wrapper.";
        };

        discoveryUrl = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Optional explicit OIDC discovery URL advertised by the node-agent deployment wrapper.";
        };

        audiences = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ "meristem-node-agent" ];
          description = "OIDC audiences advertised by the node-agent deployment wrapper.";
        };

        allowedAlgorithms = lib.mkOption {
          type = lib.types.listOf (lib.types.enum [ "RS256" "RS384" "RS512" "ES256" "ES384" ]);
          default = [ "RS256" "ES256" ];
          description = "OIDC algorithms advertised by the node-agent deployment wrapper.";
        };

        jwksCache = {
          refreshIntervalMs = lib.mkOption {
            type = lib.types.int;
            default = 300000;
            description = "OIDC JWKS refresh interval advertised by the node-agent deployment wrapper.";
          };

          ttlMs = lib.mkOption {
            type = lib.types.int;
            default = 900000;
            description = "OIDC JWKS TTL advertised by the node-agent deployment wrapper.";
          };
        };

        clockToleranceSeconds = lib.mkOption {
          type = lib.types.int;
          default = 30;
          description = "OIDC clock tolerance advertised by the node-agent deployment wrapper.";
        };
      };
    };

    netbird = {
      signalEndpoint = lib.mkOption {
        type = lib.types.str;
        default = "https://signal.control-plane.example.com:443";
        description = "NetBird Signal endpoint reference advertised by the node-agent deployment wrapper.";
      };

      relayEndpoint = lib.mkOption {
        type = lib.types.str;
        default = "turns://relay.control-plane.example.com:443";
        description = "NetBird Relay endpoint reference advertised by the node-agent deployment wrapper.";
      };

      stunEndpoint = lib.mkOption {
        type = lib.types.str;
        default = "stun:relay.control-plane.example.com:3478";
        description = "NetBird STUN endpoint reference advertised by the node-agent deployment wrapper.";
      };
    };

    secrets = {
      providerName = lib.mkOption {
        type = lib.types.str;
        default = "local-dev";
        description = "Named SecretProvider instance exposed to the node-agent runtime.";
      };

      providerBackend = lib.mkOption {
        type = lib.types.enum [ "local-dev-env" "vault-kv-v2" ];
        default = "local-dev-env";
        description = "SecretProvider backend contract used for node-agent sidecar and NetBird secret refs.";
      };

      localDevEnvMappings = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        description = "local-dev SecretProvider keyPath to env mapping emitted into the node-agent v0.2 deployment wrapper.";
      };

      cache = {
        freshTtlMs = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
          description = "Optional SecretProvider fresh cache TTL emitted into the node-agent deployment wrapper.";
        };

        staleTtlMs = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
          description = "Optional SecretProvider stale cache TTL emitted into the node-agent deployment wrapper.";
        };
      };

      vault = {
        address = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Vault KV v2 base address used by node-agent secret resolution.";
        };

        mountPath = lib.mkOption {
          type = lib.types.str;
          default = "secret";
          description = "Vault KV v2 mount path used by node-agent secret resolution.";
        };

        authMethodRef = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Opaque auth-method reference resolved by the node-agent SecretProvider runtime.";
        };
      };

      netbird = {
        signalCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird Signal credentials exposed to node-agent wiring.";
        };

        relayCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird Relay credentials exposed to node-agent wiring.";
        };

        stunCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird STUN credentials exposed to node-agent wiring.";
        };
      };

      sidecar = {
        authTokenRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for node-agent sidecar auth token material.";
        };

        configSecretRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for node-agent sidecar config fragments.";
        };
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.workspaceDir != "";
        message = "services.meristemNodeAgent.workspaceDir must point at a Meristem checkout.";
      }
      {
        assertion = cfg.capabilities.netAdmin;
        message = "services.meristemNodeAgent.capabilities.netAdmin must remain enabled for v0.2 node-agent hosts.";
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
        MERISTEM_IP_BINARY_PATH=${cfg.capabilities.ipBinaryPath}
        MERISTEM_WSTUNNEL_BINARY_PATH=${cfg.wstunnelBinaryPath}
        MERISTEM_ACME_DIRECTORY=${cfg.acmeDirectory}
        MERISTEM_ACME_ACCOUNT_KEY=${cfg.acmeAccountKeyPath}
        MERISTEM_HOST_PRIVATE_KEY_PATH=${cfg.wgPrivateKeyPath}
        MERISTEM_RELAY_ENDPOINT=${cfg.relayEndpoint}
        MERISTEM_MNET_CONTROL_URL=${cfg.controlPlane.mnetUrl}
        MERISTEM_LOG_LEVEL=info
        MERISTEM_NODE_AGENT_ROLE=${cfg.nodeRole}
        MERISTEM_NODE_AGENT_NAME=${cfg.nodeName}
      '';
      "meristem/node-agent/deployment-v02.json".text = builtins.toJSON deploymentV02Config;
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
        MERISTEM_WIREGUARD_MODULE_PATH = cfg.capabilities.wireguardModulePath;
      } // secretRefEnvironment // cfg.extraEnvironment;
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
        AmbientCapabilities = lib.optionals cfg.capabilities.netAdmin [ "CAP_NET_ADMIN" ];
        CapabilityBoundingSet = lib.optionals cfg.capabilities.netAdmin [ "CAP_NET_ADMIN" ];
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadOnlyPaths = [ cfg.workspaceDir cfg.configDir ];
      };
    };
  };
}
