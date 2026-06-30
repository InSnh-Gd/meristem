{ config, lib, pkgs, ... }:

let
  cfg = config.services.meristem;
  relayCfg = cfg.relay;
  deploymentConfigPath = "/etc/meristem/deployment-v02.json";
  mkSecretRef =
    keyPath:
    if keyPath == null then
      null
    else
      {
        provider = cfg.secrets.providerName;
        inherit keyPath;
      };
  deploymentSecretBindings = builtins.filter (binding: binding != null) [
    (if cfg.deployment.internalAuth.tokenSecretRef == null then
      null
    else
      {
        envVar = cfg.deployment.internalAuth.tokenEnvVar;
        ref = mkSecretRef cfg.deployment.internalAuth.tokenSecretRef;
      })
    (if cfg.secrets.oidc.clientSecretRef == null then
      null
    else
      {
        envVar = "MERISTEM_OIDC_CLIENT_SECRET";
        ref = mkSecretRef cfg.secrets.oidc.clientSecretRef;
      })
    (if cfg.secrets.oidc.jwksRef == null then
      null
    else
      {
        envVar = "MERISTEM_OIDC_JWKS";
        ref = mkSecretRef cfg.secrets.oidc.jwksRef;
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
  namedSecretProviderConfig =
    {
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
  deploymentV02Config = {
    track = "nixos";
    serviceUrls = cfg.deployment.serviceUrls;
    internalAuth = {
      headerName = cfg.deployment.internalAuth.headerName;
      tokenEnvVar = cfg.deployment.internalAuth.tokenEnvVar;
    }
    // lib.optionalAttrs (cfg.deployment.internalAuth.tokenSecretRef != null) {
      tokenSecretRef = mkSecretRef cfg.deployment.internalAuth.tokenSecretRef;
    };
    oidc = {
      provider = "oidc";
      issuer = cfg.deployment.oidc.issuer;
      audiences = cfg.deployment.oidc.audiences;
      allowedAlgorithms = cfg.deployment.oidc.allowedAlgorithms;
      jwksCache = {
        refreshIntervalMs = cfg.deployment.oidc.jwksCache.refreshIntervalMs;
        ttlMs = cfg.deployment.oidc.jwksCache.ttlMs;
      };
      clockToleranceSeconds = cfg.deployment.oidc.clockToleranceSeconds;
    }
    // lib.optionalAttrs (cfg.deployment.oidc.discoveryUrl != null) {
      discoveryUrl = cfg.deployment.oidc.discoveryUrl;
    };
    secretProvider = {
      providerName = cfg.secrets.providerName;
      backend = cfg.secrets.providerBackend;
      namedProvider = namedSecretProviderConfig;
    };
    secretBindings = deploymentSecretBindings;
    netbird = cfg.deployment.netbird;
    nodeAgentCapabilities = cfg.deployment.nodeAgentCapabilities;
    readiness = {
      postgres = {
        kind = "postgres-select-1";
        target = "postgres";
      };
      core = {
        kind = "http-get";
        target = "core";
        endpoint = "${cfg.deployment.serviceUrls.core}/api/v0/ready";
      };
      mnet = {
        kind = "http-get";
        target = "m-net";
        endpoint = "${cfg.deployment.serviceUrls.mnet}/ready";
      };
      policy = {
        kind = "http-get";
        target = "m-policy";
        endpoint = "${cfg.deployment.serviceUrls.policy}/ready";
      };
      log = {
        kind = "http-get";
        target = "m-log";
        endpoint = "${cfg.deployment.serviceUrls.log}/ready";
      };
      eventbus = {
        kind = "http-get";
        target = "m-eventbus";
        endpoint = "${cfg.deployment.serviceUrls.eventbus}/ready";
      };
      task = {
        kind = "http-get";
        target = "m-task";
        endpoint = "${cfg.deployment.serviceUrls.task}/health";
      };
      extension = {
        kind = "http-get";
        target = "m-extension";
        endpoint = "${cfg.deployment.serviceUrls.extension}/ready";
      };
      uiBff = {
        kind = "http-get";
        target = "m-ui-bff";
        endpoint = "${cfg.deployment.serviceUrls.uiBff}/ready";
      };
      nodeAgent = {
        kind = "command";
        target = "node-agent";
        command = [ "systemctl" "is-active" "meristem-node-agent.service" ];
      };
    };
  };
  secretProviderEnvironment =
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
    // lib.optionalAttrs (cfg.secrets.oidc.clientSecretRef != null) {
      MERISTEM_OIDC_CLIENT_SECRET_REF = cfg.secrets.oidc.clientSecretRef;
    }
    // lib.optionalAttrs (cfg.secrets.oidc.jwksRef != null) {
      MERISTEM_OIDC_JWKS_SECRET_REF = cfg.secrets.oidc.jwksRef;
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
    }
    // cfg.secrets.deploymentEnvSecretRefs;

  composeBase = import ./compose/base.nix {
    inherit lib pkgs;
    composeEnvFile = cfg.composeEnvFile;
    workspaceDir = cfg.workspaceDir;
  };
  composeOpenSearch = import ./compose/opensearch.nix {
    inherit lib pkgs;
    workspaceDir = cfg.workspaceDir;
  };
  composeRedis = import ./compose/redis.nix {
    inherit lib pkgs;
    workspaceDir = cfg.workspaceDir;
  };
  composeApisix = import ./compose/apisix.nix {
    inherit lib pkgs;
    workspaceDir = cfg.workspaceDir;
  };

  relayWstunnelVersion = "v10.5.5";
  relayWstunnelReleaseVersion = lib.removePrefix "v" relayWstunnelVersion;
  relayWstunnelArchiveName =
    if pkgs.stdenv.hostPlatform.isAarch64 then
      "wstunnel_${relayWstunnelReleaseVersion}_linux_arm64.tar.gz"
    else
      "wstunnel_${relayWstunnelReleaseVersion}_linux_amd64.tar.gz";
  relayWstunnelArchiveHash =
    if pkgs.stdenv.hostPlatform.isAarch64 then
      "sha256-db85183da9732f26c110a08e3fffdfcfc4a44d544035d01eeefa708ed23874bb"
    else
      "sha256-b20ffa02e945ec0c0d6b153ba69a290593f0957ed2892aee8f987f715ccd95d6";
  relayWstunnelBinarySource =
    "https://github.com/erebe/wstunnel/releases/download/${relayWstunnelVersion}/${relayWstunnelArchiveName}";
  relayWstunnelContainerSource = "ghcr.io/erebe/wstunnel:${relayWstunnelVersion}";
  relayWstunnelPackage = pkgs.stdenvNoCC.mkDerivation {
    pname = "wstunnel";
    version = relayWstunnelReleaseVersion;
    src = pkgs.fetchurl {
      url = relayWstunnelBinarySource;
      hash = relayWstunnelArchiveHash;
    };
    nativeBuildInputs = [ pkgs.gnutar pkgs.gzip ];
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/bin"
      tar -xzf "$src" -C "$out/bin" wstunnel
      chmod 0555 "$out/bin/wstunnel"
      runHook postInstall
    '';
  };
  relayTlsDirectory = "${relayCfg.configDir}/tls";
  relayTlsCertPath =
    if relayCfg.mode == "acme" then
      "${relayTlsDirectory}/fullchain.pem"
    else
      "/var/lib/meristem/certs/join-ingress-cert.pem";
  relayTlsKeyPath =
    if relayCfg.mode == "acme" then
      "${relayTlsDirectory}/key.pem"
    else
      "/var/lib/meristem/certs/join-ingress-key.pem";
  relayHealthUrl = "http://${relayCfg.healthBind}:${toString relayCfg.healthPort}/health";
  relayPublicEndpoint = "wss://${relayCfg.publicHostname}:${toString relayCfg.publicPort}";
  relayWrapper = pkgs.writeShellScript "meristem-wstunnel-relay-start" ''
    set -euo pipefail

    ${pkgs.busybox}/bin/httpd -f -p ${relayCfg.healthBind}:${toString relayCfg.healthPort} -h ${relayCfg.configDir}/health &
    health_pid=$!

    cleanup() {
      kill "$health_pid" 2>/dev/null || true
    }

    trap cleanup EXIT INT TERM

    ${pkgs.jq}/bin/jq -cn \
      --arg event "relay.starting" \
      --arg service "meristem-wstunnel-relay" \
      --arg version "${relayCfg.versionPin}" \
      --arg endpoint "${relayPublicEndpoint}" \
      --arg healthUrl "${relayHealthUrl}" \
      --arg mode "${relayCfg.mode}" \
      --arg configDir "${relayCfg.configDir}" \
      '{event:$event,service:$service,version:$version,endpoint:$endpoint,healthUrl:$healthUrl,mode:$mode,configDir:$configDir}'

    ${relayWstunnelPackage}/bin/wstunnel server wss://${relayCfg.listenAddress}:${toString relayCfg.publicPort} \
      --restrict-to ${relayCfg.restrictHost}:${toString relayCfg.wireGuardPort} \
      --restrict-config ${relayCfg.configDir}/restrictions.yaml \
      --restrict-http-upgrade-path-prefix ${relayCfg.pathPrefix} \
      --tls-certificate ${relayTlsCertPath} \
      --tls-private-key ${relayTlsKeyPath} \
      --log-lvl ${relayCfg.logLevel} \
      --no-color 2>&1 | while IFS= read -r line; do
        ${pkgs.jq}/bin/jq -cn \
          --arg service "meristem-wstunnel-relay" \
          --arg source "wstunnel" \
          --arg version "${relayCfg.versionPin}" \
          --arg endpoint "${relayPublicEndpoint}" \
          --arg healthUrl "${relayHealthUrl}" \
          --arg mode "${relayCfg.mode}" \
          --arg message "$line" \
          '{service:$service,source:$source,version:$version,endpoint:$endpoint,healthUrl:$healthUrl,mode:$mode,message:$message}'
      done

    exit "''${PIPESTATUS[0]}"
  '';

  infraDependencies = [
    "docker-meristem-postgres.service"
    "docker-meristem-nats.service"
    "docker-compose-meristem-root.target"
  ];

  bootstrapDependencies = lib.optionals cfg.bootstrap.enable [ "meristem-bootstrap.service" ];

  mkMeristemService =
    {
      description,
      serviceName,
      after ? [ ],
      wants ? [ ]
    }:
    {
      inherit description;
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ] ++ infraDependencies ++ bootstrapDependencies ++ after;
      wants = [ "network-online.target" ] ++ infraDependencies ++ bootstrapDependencies ++ wants;
      environmentFile = cfg.environmentFile;
      environment = secretProviderEnvironment;
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.workspaceDir;
        ExecStart = "${cfg.bunPackage}/bin/bun run ${serviceName}";
        Restart = "on-failure";
        RestartSec = 2;
        NoNewPrivileges = true;
      };
    };
in
{
  options.services.meristem = {
    enable = lib.mkEnableOption "Meristem optional NixOS service bundle";

    workspaceDir = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "/srv/meristem";
      description = "Path to the Meristem checkout that Bun and compose2nix-derived binds should run from.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "/etc/meristem/meristem.env";
      description = "Environment file consumed by every Meristem systemd unit.";
    };

    bunPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.bun;
      description = "Bun package used to execute Meristem services.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "meristem";
      description = "System user that owns Meristem service processes.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "meristem";
      description = "System group that owns Meristem service processes.";
    };

    composeEnvFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/meristem/compose/base.env";
      description = "Environment file consumed by compose2nix-derived infrastructure containers for secret-bearing values.";
    };

    enableUiBff = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to run the M-UI BFF systemd unit.";
    };

    enableUi = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to run the SvelteKit M-UI systemd unit.";
    };

    enableOpenSearch = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to run the optional OpenSearch container through compose2nix-style Nix wiring.";
    };

    enableRedis = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to run the optional Redis container through compose2nix-style Nix wiring.";
    };

    enableApisix = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to run the optional APISIX container through compose2nix-style Nix wiring.";
    };

    relay = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to run the pinned wstunnel relay sidecar on the control-plane host.";
      };

      mode = lib.mkOption {
        type = lib.types.enum [ "acme" "local-dev" ];
        default = "local-dev";
        description = "Whether the relay should require an ACME-managed public hostname or use a loopback-friendly local-development fallback.";
      };

      publicHostname = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
        example = "relay.control-plane.example.com";
        description = "Public hostname advertised by the fallback relay endpoint.";
      };

      publicPort = lib.mkOption {
        type = lib.types.port;
        default = 443;
        description = "Public WSS port exposed by the fallback relay.";
      };

      listenAddress = lib.mkOption {
        type = lib.types.str;
        default = "[::]";
        description = "Bind address passed to the wstunnel server.";
      };

      configDir = lib.mkOption {
        type = lib.types.str;
        default = "/etc/meristem/wstunnel";
        description = "Directory that stores relay restrictions, health assets, and ACME material.";
      };

      pathPrefix = lib.mkOption {
        type = lib.types.str;
        default = "meristem-fallback-relay";
        description = "Upgrade-path prefix used to scope accepted relay traffic.";
      };

      restrictHost = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
        description = "Host target allowed by the relay restriction rule.";
      };

      wireGuardPort = lib.mkOption {
        type = lib.types.port;
        default = 51820;
        description = "Local WireGuard UDP port exposed through the relay.";
      };

      healthBind = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1";
        description = "Loopback bind used by the relay health endpoint.";
      };

      healthPort = lib.mkOption {
        type = lib.types.port;
        default = 19090;
        description = "Loopback port used by the relay health endpoint.";
      };

      logLevel = lib.mkOption {
        type = lib.types.str;
        default = "INFO";
        description = "wstunnel log level forwarded to the systemd journal.";
      };

      versionPin = lib.mkOption {
        type = lib.types.str;
        default = relayWstunnelVersion;
        description = "Pinned upstream wstunnel release tag.";
      };

      binarySource = lib.mkOption {
        type = lib.types.str;
        default = relayWstunnelBinarySource;
        description = "Pinned GitHub release archive used by the relay service.";
      };

      containerSource = lib.mkOption {
        type = lib.types.str;
        default = relayWstunnelContainerSource;
        description = "Pinned official container image reference kept alongside the binary source.";
      };
    };

    bootstrap = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to run the bootstrap oneshot that prepares certs, migrations, and seed data before Meristem services start.";
      };

      generateCerts = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the bootstrap oneshot should generate the join-ingress self-signed certs.";
      };

      migrate = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the bootstrap oneshot should run database migrations.";
      };

      seed = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the bootstrap oneshot should seed local demo data.";
      };
    };

    secrets = {
      providerName = lib.mkOption {
        type = lib.types.str;
        default = "local-dev";
        description = "Named SecretProvider instance advertised to Meristem services.";
      };

      providerBackend = lib.mkOption {
        type = lib.types.enum [ "local-dev-env" "vault-kv-v2" ];
        default = "local-dev-env";
        description = "SecretProvider backend contract used by deployment wiring.";
      };

      localDevEnvMappings = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        description = "local-dev SecretProvider keyPath to environment-variable mapping emitted into the v0.2 deployment wrapper.";
      };

      cache = {
        freshTtlMs = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
          description = "Optional SecretProvider fresh cache TTL advertised in the v0.2 deployment wrapper.";
        };

        staleTtlMs = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
          description = "Optional SecretProvider stale cache TTL advertised in the v0.2 deployment wrapper.";
        };
      };

      vault = {
        address = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Vault KV v2 base address for the first production SecretProvider backend.";
        };

        mountPath = lib.mkOption {
          type = lib.types.str;
          default = "secret";
          description = "Vault KV v2 mount path used by the SecretProvider contract.";
        };

        authMethodRef = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Opaque auth-method reference resolved by the runtime SecretProvider.";
        };
      };

      oidc = {
        clientSecretRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for the future OIDC client secret consumer boundary.";
        };

        jwksRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for the future OIDC JWKS material consumer boundary.";
        };
      };

      netbird = {
        signalCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird Signal credentials.";
        };

        relayCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird Relay credentials.";
        };

        stunCredentialRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for NetBird STUN credentials.";
        };
      };

      sidecar = {
        authTokenRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for node sidecar auth token material.";
        };

        configSecretRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef for sidecar config fragments that must not live in plaintext deployment env.";
        };
      };

      deploymentEnvSecretRefs = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        description = "Additional env-var to SecretRef bindings exported to Meristem services.";
      };
    };

    deployment = {
      serviceUrls = {
        core = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3000";
          description = "Core base URL advertised by the v0.2 deployment wrapper.";
        };

        mnet = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3104";
          description = "M-Net base URL advertised by the v0.2 deployment wrapper.";
        };

        policy = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3101";
          description = "M-Policy base URL advertised by the v0.2 deployment wrapper.";
        };

        log = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3102";
          description = "M-Log base URL advertised by the v0.2 deployment wrapper.";
        };

        eventbus = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3103";
          description = "M-EventBus base URL advertised by the v0.2 deployment wrapper.";
        };

        task = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3105";
          description = "M-Task base URL advertised by the v0.2 deployment wrapper.";
        };

        extension = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3106";
          description = "M-Extension base URL advertised by the v0.2 deployment wrapper.";
        };

        uiBff = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3200";
          description = "M-UI BFF base URL advertised by the v0.2 deployment wrapper.";
        };

        nodeAgent = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:3307";
          description = "Node-agent control endpoint reference advertised by the v0.2 deployment wrapper.";
        };
      };

      internalAuth = {
        headerName = lib.mkOption {
          type = lib.types.str;
          default = "x-meristem-internal-token";
          description = "Internal auth header name advertised by the v0.2 deployment wrapper.";
        };

        tokenEnvVar = lib.mkOption {
          type = lib.types.str;
          default = "MERISTEM_INTERNAL_TOKEN";
          description = "Environment variable name that carries the internal auth token.";
        };

        tokenSecretRef = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "SecretRef keyPath for the internal auth token metadata exposed by the v0.2 deployment wrapper.";
        };
      };

      oidc = {
        issuer = lib.mkOption {
          type = lib.types.str;
          default = "https://identity.control-plane.example.com";
          description = "OIDC issuer used by the v0.2 deployment wrapper.";
        };

        discoveryUrl = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Optional explicit OIDC discovery URL used by the v0.2 deployment wrapper.";
        };

        audiences = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ "meristem-core" "meristem-operators" ];
          description = "Allowed OIDC audiences advertised by the v0.2 deployment wrapper.";
        };

        allowedAlgorithms = lib.mkOption {
          type = lib.types.listOf (lib.types.enum [ "RS256" "RS384" "RS512" "ES256" "ES384" ]);
          default = [ "RS256" "ES256" ];
          description = "OIDC signing algorithms advertised by the v0.2 deployment wrapper.";
        };

        jwksCache = {
          refreshIntervalMs = lib.mkOption {
            type = lib.types.int;
            default = 300000;
            description = "OIDC JWKS refresh interval advertised by the v0.2 deployment wrapper.";
          };

          ttlMs = lib.mkOption {
            type = lib.types.int;
            default = 900000;
            description = "OIDC JWKS hard TTL advertised by the v0.2 deployment wrapper.";
          };
        };

        clockToleranceSeconds = lib.mkOption {
          type = lib.types.int;
          default = 30;
          description = "OIDC clock tolerance advertised by the v0.2 deployment wrapper.";
        };
      };

      netbird = {
        signalEndpoint = lib.mkOption {
          type = lib.types.str;
          default = "https://signal.control-plane.example.com:443";
          description = "NetBird Signal endpoint reference advertised by the v0.2 deployment wrapper.";
        };

        relayEndpoint = lib.mkOption {
          type = lib.types.str;
          default = "turns://relay.control-plane.example.com:443";
          description = "NetBird Relay endpoint reference advertised by the v0.2 deployment wrapper.";
        };

        stunEndpoint = lib.mkOption {
          type = lib.types.str;
          default = "stun:relay.control-plane.example.com:3478";
          description = "NetBird STUN endpoint reference advertised by the v0.2 deployment wrapper.";
        };
      };

      nodeAgentCapabilities = {
        netAdmin = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Whether node-agent hosts are expected to provide CAP_NET_ADMIN.";
        };

        wireguardModulePath = lib.mkOption {
          type = lib.types.str;
          default = "/sys/module/wireguard";
          description = "WireGuard kernel module path expected on node-agent hosts.";
        };

        wgBinaryPath = lib.mkOption {
          type = lib.types.str;
          default = "/run/current-system/sw/bin/wg";
          description = "WireGuard userspace binary path expected on node-agent hosts.";
        };

        ipBinaryPath = lib.mkOption {
          type = lib.types.str;
          default = "/run/current-system/sw/bin/ip";
          description = "iproute2 binary path expected on node-agent hosts.";
        };

        wstunnelBinaryPath = lib.mkOption {
          type = lib.types.str;
          default = "/run/current-system/sw/bin/wstunnel";
          description = "Legacy relay tool path kept as deployment metadata for migration windows.";
        };
      };
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      composeBase
      (lib.mkIf cfg.enableOpenSearch composeOpenSearch)
      (lib.mkIf cfg.enableRedis composeRedis)
      (lib.mkIf cfg.enableApisix composeApisix)
      {
        assertions = [
          {
            assertion = cfg.workspaceDir != "";
            message = "services.meristem.workspaceDir must point at a Meristem checkout.";
          }
          {
            assertion = cfg.environmentFile != "";
            message = "services.meristem.environmentFile must point at a readable env file.";
          }
          {
            assertion =
              (!relayCfg.enable)
              || relayCfg.mode != "acme"
              || (
                !(builtins.elem relayCfg.publicHostname [ "localhost" "127.0.0.1" "::1" ])
                && lib.hasInfix "." relayCfg.publicHostname
              );
            message = "services.meristem.relay.publicHostname must be a public ACME hostname when relay.mode = \"acme\".";
          }
        ];

        users.groups.${cfg.group} = { };
        users.users.${cfg.user} = {
          isSystemUser = true;
          inherit (cfg) group;
          home = cfg.workspaceDir;
          createHome = false;
        };

        networking.firewall.allowedTCPPorts = [ 8443 ] ++ lib.optionals relayCfg.enable [ relayCfg.publicPort ];

        environment.etc = lib.mkMerge [
          {
            "meristem/deployment-v02.json".text = builtins.toJSON deploymentV02Config;
          }
          (lib.optionalAttrs relayCfg.enable {
            "meristem/wstunnel/restrictions.yaml".text = ''
            restrictions:
              - name: "meristem-wireguard-fallback"
                description: "Only allow UDP-over-WSS relay traffic to the local WireGuard port."
                match:
                  - !PathPrefix "^${relayCfg.pathPrefix}$"
                allow:
                  - !Tunnel
                    protocol:
                      - Udp
                    port:
                      - ${toString relayCfg.wireGuardPort}
                    host: ^${relayCfg.restrictHost}$
                    cidr:
                      - 127.0.0.1/32
                      - ::1/128
          '';
            "meristem/wstunnel/health/health".text = "ok\n";
            "meristem/wstunnel/relay-config.json".text = builtins.toJSON {
              binarySource = relayCfg.binarySource;
              command = [
                "wstunnel"
                "server"
                "wss://${relayCfg.listenAddress}:${toString relayCfg.publicPort}"
                "--restrict-to"
                "${relayCfg.restrictHost}:${toString relayCfg.wireGuardPort}"
                "--restrict-config"
                "${relayCfg.configDir}/restrictions.yaml"
                "--restrict-http-upgrade-path-prefix"
                relayCfg.pathPrefix
                "--tls-certificate"
                relayTlsCertPath
                "--tls-private-key"
                relayTlsKeyPath
                "--log-lvl"
                relayCfg.logLevel
                "--no-color"
              ];
              configDir = relayCfg.configDir;
              containerSource = relayCfg.containerSource;
              endpoint = relayPublicEndpoint;
              healthUrl = relayHealthUrl;
              logFields = [ "service" "source" "version" "endpoint" "healthUrl" "mode" "message" ];
              mode = relayCfg.mode;
              versionPin = relayCfg.versionPin;
            };
          })
        ];

        systemd.tmpfiles.rules = lib.optionals relayCfg.enable [
          "d ${relayCfg.configDir} 0750 root ${cfg.group} - -"
          "d ${relayCfg.configDir}/health 0755 root root - -"
          "d ${relayTlsDirectory} 0750 root ${cfg.group} - -"
        ];

        systemd.services = lib.mkMerge [
          (lib.mkIf cfg.bootstrap.enable {
            meristem-bootstrap = {
              description = "Meristem bootstrap preparation";
              wantedBy = [ "multi-user.target" ];
              after = [ "network-online.target" ] ++ infraDependencies;
              wants = [ "network-online.target" ] ++ infraDependencies;
              environmentFile = cfg.environmentFile;
              serviceConfig = {
                Type = "oneshot";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = cfg.workspaceDir;
                RemainAfterExit = true;
                NoNewPrivileges = true;
              };
              script = lib.concatStringsSep "\n" (
                lib.optionals cfg.bootstrap.generateCerts [
                  "${cfg.bunPackage}/bin/bun run scripts/certs-dev.ts"
                ]
                ++ lib.optionals cfg.bootstrap.migrate [
                  "${cfg.bunPackage}/bin/bun run db:migrate"
                ]
                ++ lib.optionals cfg.bootstrap.seed [
                  "${cfg.bunPackage}/bin/bun run db:seed"
                ]
              );
            };
          })
          (lib.mkIf relayCfg.enable {
            meristem-wstunnel-relay = {
              description = "Meristem pinned wstunnel relay sidecar";
              wantedBy = [ "multi-user.target" ];
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              environment = {
                MERISTEM_RELAY_CONFIG_DIR = relayCfg.configDir;
                MERISTEM_RELAY_ENDPOINT = relayPublicEndpoint;
                MERISTEM_RELAY_HEALTHCHECK = relayHealthUrl;
                MERISTEM_WSTUNNEL_BINARY_SOURCE = relayCfg.binarySource;
                MERISTEM_WSTUNNEL_CONTAINER_SOURCE = relayCfg.containerSource;
                MERISTEM_WSTUNNEL_VERSION = relayCfg.versionPin;
              };
              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = cfg.workspaceDir;
                ExecStartPre = [
                  "${pkgs.coreutils}/bin/test -r ${relayCfg.configDir}/restrictions.yaml"
                  "${pkgs.coreutils}/bin/test -r ${relayTlsCertPath}"
                  "${pkgs.coreutils}/bin/test -r ${relayTlsKeyPath}"
                ];
                ExecStart = relayWrapper;
                ExecStartPost = "${pkgs.curl}/bin/curl --fail --silent --show-error --max-time 3 ${relayHealthUrl}";
                Restart = "on-failure";
                RestartSec = 2;
                NoNewPrivileges = true;
                AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
                CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
                StandardOutput = "journal";
                StandardError = "journal";
                SyslogIdentifier = "meristem-wstunnel-relay";
              };
            };
          })
          {
            meristem-m-eventbus = mkMeristemService {
              description = "Meristem M-EventBus";
              serviceName = "dev:m-eventbus";
            };

            meristem-m-policy = mkMeristemService {
              description = "Meristem M-Policy";
              serviceName = "dev:m-policy";
            };

            meristem-m-log = mkMeristemService {
              description = "Meristem M-Log";
              serviceName = "dev:m-log";
            };

            meristem-m-net = mkMeristemService {
              description = "Meristem M-Net";
              serviceName = "dev:m-net";
            };

            meristem-m-task = mkMeristemService {
              description = "Meristem M-Task";
              serviceName = "dev:m-task";
            };

            meristem-m-extension = mkMeristemService {
              description = "Meristem M-Extension";
              serviceName = "dev:m-extension";
              after = [
                "meristem-m-eventbus.service"
                "meristem-m-policy.service"
                "meristem-m-log.service"
              ];
              wants = [
                "meristem-m-eventbus.service"
                "meristem-m-policy.service"
                "meristem-m-log.service"
              ];
            };

            meristem-core = mkMeristemService {
              description = "Meristem Core";
              serviceName = "dev:core-app";
              after = [
                "meristem-m-eventbus.service"
                "meristem-m-policy.service"
                "meristem-m-log.service"
                "meristem-m-net.service"
                "meristem-m-task.service"
                "meristem-m-extension.service"
              ];
              wants = [
                "meristem-m-eventbus.service"
                "meristem-m-policy.service"
                "meristem-m-log.service"
                "meristem-m-net.service"
                "meristem-m-task.service"
                "meristem-m-extension.service"
              ];
            };
          }
          (lib.mkIf cfg.enableUiBff {
            meristem-m-ui-bff = mkMeristemService {
              description = "Meristem M-UI BFF";
              serviceName = "dev:m-ui-bff";
              after = [
                "meristem-core.service"
                "meristem-m-task.service"
              ];
              wants = [
                "meristem-core.service"
                "meristem-m-task.service"
              ];
            };
          })
          (lib.mkIf cfg.enableUi {
            meristem-m-ui = mkMeristemService {
              description = "Meristem M-UI";
              serviceName = "deploy:m-ui";
              after = [ "meristem-m-ui-bff.service" ];
              wants = [ "meristem-m-ui-bff.service" ];
            };
          })
        ];
      }
    ]
  );
}
