{ ... }:

{
  imports = [ ../module.nix ];

  services.meristem = {
    enable = true;
    bootstrap.enable = true;
  };
}
