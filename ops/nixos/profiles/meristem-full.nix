{ ... }:

{
  imports = [ ./meristem-webui.nix ];

  services.meristem = {
    enableOpenSearch = true;
    enableRedis = true;
    enableApisix = true;

    deployment = {
      serviceUrls = {
        core = "http://127.0.0.1:3000";
        mnet = "http://127.0.0.1:3104";
        policy = "http://127.0.0.1:3101";
        log = "http://127.0.0.1:3102";
        eventbus = "http://127.0.0.1:3103";
        task = "http://127.0.0.1:3105";
        extension = "http://127.0.0.1:3106";
        uiBff = "http://127.0.0.1:3200";
        nodeAgent = "http://127.0.0.1:3307";
      };
      internalAuth.tokenSecretRef = "deployment/internal-token";
      oidc = {
        issuer = "https://identity.control-plane.example.com";
        discoveryUrl = "https://identity.control-plane.example.com/.well-known/openid-configuration";
        audiences = [ "meristem-core" "meristem-operators" ];
      };
      netbird = {
        signalEndpoint = "https://signal.control-plane.example.com:443";
        relayEndpoint = "turns://relay.control-plane.example.com:443";
        stunEndpoint = "stun:relay.control-plane.example.com:3478";
      };
    };

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

    secrets = {
      providerName = "vault-main";
      providerBackend = "vault-kv-v2";
      vault = {
        address = "https://vault.control-plane.example.com";
        mountPath = "kv";
        authMethodRef = "auth/approle/meristem";
      };
      oidc = {
        clientSecretRef = "oidc/client-secret";
        jwksRef = "oidc/jwks";
      };
      netbird = {
        signalCredentialRef = "netbird/signal";
        relayCredentialRef = "netbird/relay";
        stunCredentialRef = "netbird/stun";
      };
    };
  };
}
