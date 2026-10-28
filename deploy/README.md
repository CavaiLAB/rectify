# qd k3s 部署

公网入口：`https://rec.deepsingularity.cn`。业务数据与镜像、Git 仓库分离。

## 运行结构

- 独立 namespace `rectify`，单副本 Deployment，`Recreate` 更新；不允许 SQLite 多副本写入。
- PVC `rectify-data` 20Gi，独立 `rectify-local-retain` StorageClass，`Retain` 回收策略。数据在 qd 的 local-path 卷，**不是跨节点高可用**；20Gi 为申请大小，local-path 不提供可靠的文件系统容量配额。
- 挂载 `/app/data`：SQLite、上传图片。容器 UID/GID 1000，根文件系统只读，临时缓存使用 `/tmp` emptyDir。
- 公网网关 `wg-hub` 终结 TLS，经 WireGuard 转发至专用 MetalLB `192.168.1.213:80`。不修改共享 Traefik 的请求超时或全局代理信任配置。
- Service / NetworkPolicy 仅允许网关与 qd 管理入口。应用只信任网关 `10.77.0.1/32` 的转发头，网关覆盖客户端传入的相关头。
- `COOKIE_SECURE=true`，未登录不能访问项目、问题或图片。账号与原数据迁移，不提供默认密码或公开注册。
- Argo Application `rectify` 读取本仓库 `main:deploy/k8s/qd`，手动同步，未启用 prune / self-heal。命名空间、存储类、PVC 带删除保护。
- 集群内 GitHub HTTPS 访问可能被重置，Argo 源使用 GitHub 官方 SSH 443：`ssh://git@ssh.github.com:443/CavaiLAB/rectify.git`。只读部署密钥放在 `argocd/rectify-repo-ssh` repository Secret；密钥不进仓库、不复用其他项目凭据，SSH 主机密钥沿用集群已验证的 GitHub known-hosts。

## 构建和发布

1. 在干净且已提交的源码中执行 `bash deploy/build-qd.sh`。代码通过 `git archive` 发送至 qd，运行数据和凭据不会进入构建上下文。
2. 将返回的镜像 digest 写入 `deploy/k8s/qd/kustomization.yaml` 的 `images`，提交 PR；CI 通过后合并。
3. 首次部署先创建命名空间和存储，再在维护 Pod 导入数据；不要在应用正在写入时覆盖 SQLite。
4. 使用 `deploy/argocd/application.yaml` 注册 Argo；核对渲染和差异后，只同步 `rectify`。
5. 验证 Pod Ready、PVC Bound、镜像 digest、`/api/health` 的 `revision`、HTTPS 证书及未登录接口401。不只依赖 Argo Healthy。

首次空库可在容器交互终端执行 `npm run user:create -- --username admin --name 管理员` 设置密码。已有库迁移时不要再次初始化账号。

## 网关与证书

`deploy/edge/rectify.conf` 是网关配置源。首次签发先安装 `rectify-http-bootstrap.conf`（仅开放 ACME 验证，其余503），执行 `nginx -t` 成功后才 reload。用已有 Certbot webroot `/var/www/letsencrypt` 为 `rec.deepsingularity.cn` 签发证书，再换完整 HTTPS 配置。不要改动其他站点。

证书目录为 `/etc/letsencrypt/live/rec.deepsingularity.cn/`，续期复用既有 `certbot.timer` 和 nginx deploy hook。HTTP 普通请求301到HTTPS。上传上限52MiB，代理超时120秒；应用仍限制最多6张、每张8MiB。

## 迁移与备份

- 迁移前停止原服务，对完整 `data/` 做权限受限备份并核对 SQLite integrity、各表记录数和附件文件数。通过 SSH 传输，不通过公共仓库或镜像搬数据。
- 迁移副本清除旧登录会话，保留账号密码哈希、项目、功能项、问题、附件和接入凭据摘要。上线后使用原账号密码重新登录。
- 导入后核对表数、附件哈希；至少做一次应用 Pod 重建后的数据保留检查。
- 存储 `Retain` 不等于备份。初始迁移备份保留在管理机，**定期与离机备份需单独安排**。
- 人工备份建议先将应用缩至0副本，使用同节点维护 Pod 打包整个卷，再恢复1副本。手动 Argo 同步期间不要并行操作备份。禁止只复制运行中的 `rectify.db` 而忽略 WAL 和附件。
- 回退应用版本：在 Git 回退镜像 digest，通过 CI 后重新同步。回退数据：停应用后用验证过的完整备份恢复卷；不要在没有明确恢复目标时覆盖当前库。

## LM 接入

LM 服务端 `Rectify:BaseUrl` 使用 `https://rec.deepsingularity.cn`，凭据仍仅保存在受限的服务端配置中。不同启动方式可能读取不同文件（`LM_CONFIG_YAML` 优先），需修改实际加载的那份。部署 Rectify 不等于已修改现场或集群中的 LM Secret。

## 日常只读检查

```bash
ssh qd 'kubectl -n rectify get deploy,pod,svc,pvc'
ssh qd 'kubectl -n argocd get application rectify'
curl -fsS https://rec.deepsingularity.cn/api/health
```
