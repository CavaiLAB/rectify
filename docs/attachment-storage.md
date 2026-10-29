# 私有附件存储

OSS 只保存反馈截图，前端静态文件和 SQLite 仍由 Rectify 服务提供。上传数量、格式、转码规则及登录权限保持不变。

## 数据与权限

- 新图片转为 WebP 后写入 `attachments/<随机UUID>.webp`，不使用客户文件名、炉号或描述作为对象键。
- Bucket 使用私有 ACL、禁止公共访问、默认 AES256 服务端加密。浏览器不直传 OSS、不接收签名链接；登录后的 `/api/attachments/:id` 由后端代理读取并校验大小和 SHA-256，响应 `private, no-store`。
- RAM 专用用户仅允许目标桶 `attachments/*` 的 `oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`，要求 `acs:SecureTransport=true`。不授予管理桶、列举其他桶、修改 ACL 的权限，不创建控制台登录。
- 使用 k3s Secret 文件挂载凭据。不要把管理凭据、应用凭据或临时安全令牌提交到 Git、镜像、日志或前端。静态凭据轮换后重建 Pod；客户端在启动时读取配置。
- `/api/health` 的 `storage` 代表配置的存储方式，不代表云服务实时可用；发版必须另做真实读写验证。

## 一致性与旧数据

- SQLite 新增 `attachment_objects`（对象位置及校验值）与 `attachment_cleanup`（暂存/清理任务）；原 `attachments` 表不改列，原账号、项目、功能项及问题不重建。
- 先在数据库保留上传登记，再在事务外上传。全部上传成功后，同一短事务提交问题与附件元数据。上传失败不会登记缺图的问题，已上传对象会回收；不确定结果保留清理任务。
- 删除图片时先原子删除可见记录并保留清理任务；云端失败后后台重试。后台每分钟最多清理3项，失败退避最多1小时，进程重启后任务仍在。程序异常退出产生的上传暂存项约1小时后具备回收条件，不是定时删除正常附件。
- 外部幂等提交、项目归档和每问题6张限制在最终提交时重新检查；不会因为等待 OSS 而跨网络持有 SQLite 写事务。
- 旧附件没有对象映射时仍从原 `DATA_DIR/uploads` 读取。切换不会删除、移动旧文件。若已有历史附件需全部迁移，应另做有备份、逐文件校验的迁移，不直接修改关联表。
- 正常附件不设置自动过期。对象删除不可恢复；OSS 不可用时上传/读取返回503，原业务数据保留，不回退成公开链接。

## 运行配置

```text
ATTACHMENT_STORAGE=oss
OSS_BUCKET=<专用私有桶>
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID_FILE=/var/run/secrets/rectify-oss/access-key-id
OSS_ACCESS_KEY_SECRET_FILE=/var/run/secrets/rectify-oss/access-key-secret
```

仅后端需要通过 HTTPS 访问对应地域 OSS；上传下载不依赖浏览器访问阿里云。采用 STS 时当前配置不自动续租，需要外部更新令牌并重建 Pod。

## 验证与回退

自动化：`npm run build`、`npm test`、`npm run test:e2e`。假 OSS 覆盖部分上传失败、删除重试、完整性失败、并发幂等与旧文件兼容，不使用生产凭据。

真实存储验证（显式执行，会上传并删除2张合成图片）：

```bash
ssh qd 'kubectl -n rectify exec deploy/rectify -- env RECTIFY_OSS_VERIFY=1 node --import tsx scripts/verify-oss.ts'
```

脚本使用随机临时 SQLite 目录、虚构账号和合成图片，通过同一应用的内部登记、外部接入、鉴权读取、删除接口验证。**不连接 `/app/data/rectify.db`，不向真实客户项目创建测试问题。** 结束时清理自己生成的对象及临时数据库；失败只输出阶段，不输出凭据。另需在对象存在时确认匿名访问为403，并核实 Bucket 私有、禁止公共访问与加密配置。

回退使用已验证的 OSS 兼容版本，保持相同 Bucket 和 Secret。**一旦已有 OSS 附件，不可直接退回只支持本地文件的旧镜像，也不可仅把存储模式改为 `local`**，否则旧云端图片不可读。不要为了回退程序覆盖当前业务数据库。SQLite 和 OSS 对象需要共同备份；当前未自动配置定期备份、版本保留或跨区域容灾。
