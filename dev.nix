{ pkgs }:
pkgs.mkShell {
  packages = with pkgs; [
    bun
    compose2nix
    curl
    docker
    git
    openssl
  ];
}
