{ ... }:

{
  imports = [ ../node-agent-module.nix ];

  services.meristemNodeAgent = {
    enable = true;
    nodeRole = "leaf";
    nodeName = "remote-leaf";
    joinUrl = "wss://control-plane.example.com:8443/join/v0/session";
    relayEndpoint = "wss://relay.control-plane.example.com:443";
    controlPlane = {
      coreUrl = "http://127.0.0.1:3000";
      mnetUrl = "http://127.0.0.1:3104";
      policyUrl = "http://127.0.0.1:3101";
      logUrl = "http://127.0.0.1:3102";
      eventbusUrl = "http://127.0.0.1:3103";
      taskUrl = "http://127.0.0.1:3105";
      extensionUrl = "http://127.0.0.1:3106";
      uiBffUrl = "http://127.0.0.1:3200";
      nodeAgentUrl = "http://127.0.0.1:3307";
      internalAuth.tokenSecretRef = "deployment/internal-token";
      oidc = {
        issuer = "https://identity.control-plane.example.com";
        discoveryUrl = "https://identity.control-plane.example.com/.well-known/openid-configuration";
        audiences = [ "meristem-node-agent" ];
      };
    };
    netbird = {
      signalEndpoint = "https://signal.control-plane.example.com:443";
      relayEndpoint = "turns://relay.control-plane.example.com:443";
      stunEndpoint = "stun:relay.control-plane.example.com:3478";
    };
    secrets = {
      providerName = "vault-main";
      providerBackend = "vault-kv-v2";
      vault = {
        address = "https://vault.control-plane.example.com";
        mountPath = "kv";
        authMethodRef = "auth/approle/meristem-node-agent";
      };
      netbird = {
        signalCredentialRef = "netbird/signal";
        relayCredentialRef = "netbird/relay";
        stunCredentialRef = "netbird/stun";
      };
    };
  };
}
