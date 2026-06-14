{ ... }:

{
  imports = [ ./meristem-webui.nix ];

  services.meristem = {
    enableOpenSearch = true;
    enableRedis = true;
    enableApisix = true;
  };
}
