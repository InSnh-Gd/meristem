{ config, lib, pkgs, ... }:

let
  cfg = config.services.meristem;
  relayCfg = cfg.relay;

  composeBase = import ./compose/base.nix {
    inherit lib pkgs;
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

        environment.etc = lib.optionalAttrs relayCfg.enable {
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
        };

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
