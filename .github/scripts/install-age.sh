#!/usr/bin/env bash
# Installs the pinned `age` release for the off-site backup tests (tests/unit/offsite.test.ts) and the
# production rehearsal (ops/rehearse.sh). The release binary is checked against a sha256 pinned here
# (the digest GitHub publishes for the asset, read when the version was chosen), so a different file
# under the same URL fails instead of running. On a real host, install age with the package manager
# instead (brew install age).
set -euo pipefail

VERSION="v1.3.2"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="linux-amd64"; sha="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10" ;;
  Linux-aarch64 | Linux-arm64) asset="linux-arm64"; sha="6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4" ;;
  Darwin-arm64) asset="darwin-arm64"; sha="e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5" ;;
  *) echo "install-age.sh: no pinned age build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/age.tar.gz" "https://github.com/FiloSottile/age/releases/download/$VERSION/age-$VERSION-$asset.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$sha" "$tmp/age.tar.gz" | sha256sum -c - >/dev/null
else
  printf '%s  %s\n' "$sha" "$tmp/age.tar.gz" | shasum -a 256 -c - >/dev/null
fi
tar -xzf "$tmp/age.tar.gz" -C "$tmp"

dest="${AGE_INSTALL_DIR:-/usr/local/bin}"
if [ -w "$dest" ]; then
  install -m 0755 "$tmp/age/age" "$tmp/age/age-keygen" "$dest/"
else
  sudo install -m 0755 "$tmp/age/age" "$tmp/age/age-keygen" "$dest/"
fi
"$dest/age" --version
