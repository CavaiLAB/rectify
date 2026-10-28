#!/usr/bin/env bash
# 只构建和推镜像，不自动改部署或同步 Argo。复用 qd 已配置的 Docker 登录。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo '请先提交代码，镜像必须对应确定的 Git 提交。' >&2
  exit 1
fi
rectify_revision=$(git rev-parse HEAD)
rectify_tag="git-${rectify_revision:0:12}"
rectify_image="192.168.1.201:80/library/rectify:${rectify_tag}"
rectify_build_dir=$(ssh -o BatchMode=yes qd 'mktemp -d /tmp/rectify-build-XXXXXX')
[[ "$rectify_build_dir" == /tmp/rectify-build-* ]] || exit 1
git archive --format=tar "$rectify_revision" | ssh -o BatchMode=yes qd "tar -xf - -C '$rectify_build_dir'"
ssh -o BatchMode=yes qd "docker build --platform linux/amd64 --build-arg APP_REVISION='$rectify_revision' -t '$rectify_image' '$rectify_build_dir' && docker push '$rectify_image'"
printf 'source_revision=%s\nimage_tag=%s\nremote_build_directory=%s\n' "$rectify_revision" "$rectify_tag" "$rectify_build_dir"
ssh -o BatchMode=yes qd "docker image inspect '$rectify_image' --format '{{index .RepoDigests 0}}'"
