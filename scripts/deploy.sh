#!/bin/bash
# Baut die App und veröffentlicht sie auf GitHub Pages (Branch gh-pages).
# Aufruf: npm run deploy
set -e
cd "$(dirname "$0")/.."
REPO=$(gh repo view --json name -q .name)
npm test
BASE_PATH="/$REPO/" npm run build
touch dist/.nojekyll
TMP=$(mktemp -d)
cp -R dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" log -1 --format=%an)" -c user.email="$(git -C "$OLDPWD" log -1 --format=%ae)" commit -q -m "Veröffentlichung $(date '+%Y-%m-%d %H:%M')"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Veröffentlicht: https://$(gh api user -q .login).github.io/$REPO/"
