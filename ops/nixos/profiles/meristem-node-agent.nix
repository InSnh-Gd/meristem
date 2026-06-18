{ ... }:

{
  imports = [ ../node-agent-module.nix ];

  services.meristemNodeAgent = {
    enable = true;
    nodeRole = "leaf";
    nodeName = "remote-leaf";
    joinUrl = "wss://control-plane.example.com:8443/join/v0/session";
    relayEndpoint = "wss://relay.control-plane.example.com:443";
  };
}
