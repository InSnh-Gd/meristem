# NixOS Deployment Adaptation

This directory adds an optional NixOS adaptation for running Meristem on a single host by letting NixOS own the Compose-defined infrastructure containers through compose2nix-style OCI wiring.

## What it provides

- `../../flake.nix` - root deployment flake that exports the Meristem NixOS module and dev shell.
- `../../dev.nix` - development shell definition shared by the root flake and includes `compose2nix`.
- `compose/base.nix` - generated compose2nix-derived Nix wiring for the default PostgreSQL and NATS containers.
- `compose/opensearch.nix` - generated optional OpenSearch container wiring.
- `compose/redis.nix` - generated optional Redis container wiring.
- `compose/apisix.nix` - generated optional APISIX container wiring.
- `module.nix` - NixOS module that composes the container modules and runs Meristem Bun services as systemd units.
- `meristem.env.example` - example environment file consumed by the systemd units.

For a same-machine non-NixOS deployment, use:

- `bun run deploy:local` - starts infra, runs cert/migrate/seed, then launches Core + BFF + static Web UI.
- `bun run deploy:local --prepare-only` - prepares infra, certs, migrations, and seed data without starting long-running services.

## What it does not provide

- production secret orchestration
- production TLS or certificate lifecycle
- image publishing or split-container runtime for the Bun services themselves

## Quick start

```bash
nix develop
bun run nix:generate
sudo install -d -m 0750 /etc/meristem
sudo install -m 0640 ops/nixos/meristem.env.example /etc/meristem/meristem.env
```

Regeneration rule:

- `docker-compose.yml` stays the source of truth for infrastructure containers.
- `bun run nix:generate` rewrites `ops/nixos/compose/*.nix` from `docker-compose.yml` using the system-installed `compose2nix`.
- The generator strips compose2nix runtime boilerplate from optional profile modules so `module.nix` can compose them without duplicate root targets.

Example NixOS configuration:

```nix
{
  imports = [ ./ops/nixos/module.nix ];

  services.meristem = {
    enable = true;
    workspaceDir = "/srv/meristem";
    environmentFile = "/etc/meristem/meristem.env";
    enableUiBff = true;
    enableUi = false;
    enableOpenSearch = false;
    enableRedis = false;
    enableApisix = false;
  };
}
```

Once enabled, NixOS owns the Compose-defined infrastructure containers through these OCI-backed units:

- `docker-meristem-postgres.service`
- `docker-meristem-nats.service`
- `docker-compose-meristem-root.target`
- optional `docker-meristem-opensearch.service`
- optional `docker-meristem-redis.service`
- optional `docker-meristem-apisix.service`

The module also exposes these Bun service units:

- `meristem-m-eventbus.service`
- `meristem-m-policy.service`
- `meristem-m-log.service`
- `meristem-m-net.service`
- `meristem-m-task.service`
- `meristem-m-extension.service`
- `meristem-core.service`
- `meristem-m-ui-bff.service` when `enableUiBff = true`
- `meristem-m-ui.service` when `enableUi = true`, served from a built static shell instead of `vite dev`

The module keeps the same loopback-oriented port model documented by the Compose files. Bun services continue to run from the checked-out workspace, while PostgreSQL, NATS, and optional profiles are managed as NixOS OCI containers.
