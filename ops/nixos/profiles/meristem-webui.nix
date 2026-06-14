{ ... }:

{
  imports = [ ./meristem-core.nix ];

  services.meristem = {
    enableUiBff = true;
    enableUi = true;
  };
}
