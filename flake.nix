{
  description = "Meristem deployment and development flake";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
  };

  outputs =
    {
      self,
      flake-utils,
      nixpkgs,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = import ./dev.nix { inherit pkgs; };
        formatter = pkgs.nixfmt-rfc-style;
      }
    )
    // {
      nixosModules.default = import ./ops/nixos/module.nix;
      nixosModules.meristem = import ./ops/nixos/module.nix;
      nixosModules.meristem-node-agent = import ./ops/nixos/node-agent-module.nix;
      nixosModules.meristem-core = import ./ops/nixos/profiles/meristem-core.nix;
      nixosModules.meristem-node-agent-profile = import ./ops/nixos/profiles/meristem-node-agent.nix;
      nixosModules.meristem-webui = import ./ops/nixos/profiles/meristem-webui.nix;
      nixosModules.meristem-full = import ./ops/nixos/profiles/meristem-full.nix;
      nixosModules.full-web = import ./ops/nixos/profiles/meristem-webui.nix;
    };
}
