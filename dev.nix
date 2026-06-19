{ pkgs }:
pkgs.mkShell {
  packages = with pkgs; [
    bun
    chromium
    compose2nix
    curl
    docker
    git
    openssl
  ];

  shellHook = ''
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

    if [ -z "''${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]; then
      if command -v google-chrome-stable >/dev/null 2>&1; then
        export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v google-chrome-stable)"
      elif command -v google-chrome >/dev/null 2>&1; then
        export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v google-chrome)"
      else
        export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.lib.getExe pkgs.chromium}"
      fi
    fi
  '';
}
