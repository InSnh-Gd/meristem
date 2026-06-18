{ ... }:

{
  imports = [ ./meristem-webui.nix ];

  services.meristem = {
    enableOpenSearch = true;
    enableRedis = true;
    enableApisix = true;

    relay = {
      enable = true;
      mode = "acme";
      publicHostname = "relay.control-plane.example.com";
      publicPort = 443;
      pathPrefix = "meristem-fallback-relay";
      healthPort = 19090;
      versionPin = "v10.5.5";
      binarySource = "https://github.com/erebe/wstunnel/releases/download/v10.5.5/wstunnel_10.5.5_linux_amd64.tar.gz";
      containerSource = "ghcr.io/erebe/wstunnel:v10.5.5";
    };
  };
}
