{ config, lib, pkgs, ... }:

let
  cfg = config.services.meristem;

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
      example = "/srv/meristem/m-vnext";
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
        ];

        users.groups.${cfg.group} = { };
        users.users.${cfg.user} = {
          isSystemUser = true;
          inherit (cfg) group;
          home = cfg.workspaceDir;
          createHome = false;
        };

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
