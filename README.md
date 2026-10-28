# Rectify · 问题整改工作台

一个独立、轻量的项目问题与整改管理系统。把 Excel 整改清单变成可协作的网页：选择项目和功能项，登记问题或新增需求，上传截图，明确责任，跟进整改与复验。

## 功能

- **项目**：创建、编辑、归档与恢复；按项目分开管理功能项和问题。
- **功能项**：下拉选择、现场新增、统一重命名；不再限于“菜单 / 设备型号”。
- **问题类型**：问题缺陷、新增功能、体验优化、其他。新增功能只登记需求，不代表已确认实施。
- **问题登记**：标题、描述、责任人、优先级、计划完成日期、图片附件。
- **图片**：支持拖拽或选择 PNG / JPG / WebP；每个问题最多6张，单张8MB、2000万像素以内。服务端解码校验、去除元数据，最长边压缩到2560像素后保存为 WebP；不作为原图档案库。
- **整改闭环**：待处理 → 处理中 → 待复验 → 已关闭；提交复验前填写整改措施，通过后才能关闭；不通过退回处理。
- **跟进**：留言、修改记录、自动记录整改完成时间；多人同时编辑时检查版本，避免覆盖。
- **检索与导出**：按功能项、类型、状态、责任人筛选；导出当前筛选结果为 Excel 可打开的 UTF-8 CSV（不含图片和跟进历史）。
- **团队**：账号密码登录、管理员添加成员、修改自己的密码；手机和电脑均可操作。

**代码仓库公开，不等于业务数据公开。** 默认不带账号、不带示例项目、不带客户资料。项目记录和图片均需登录。当前是单团队工作空间：所有登录成员可查看、创建和维护所有项目，不是按客户隔离的多租户平台。请为每个需要隔离的团队单独部署。

## 本地运行

需要 Node.js 24 LTS 或更新的受支持版本（24–26），npm。

```bash
npm ci
npm run user:create -- --username admin --name 管理员
# 按提示输入并确认至少12位密码，不显示在终端。
npm run dev
```

打开 `http://127.0.0.1:5188`。前端端口5188、后端3188。**不连接其他系统或生产数据库。** 数据独立保存在 `./data/rectify.db`，图片保存在 `./data/uploads/`。

初次登录后：创建项目 → 添加功能项 → 登记问题。管理员可在“团队与账号”中添加其他成员。

### 构建与验证

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

端到端测试使用临时 SQLite 数据库、虚构账号和图片，结束后自动移除，不访问真实项目。测试覆盖登录、创建项目、现场新增功能项、需求登记、图片上传、整改复验、关闭、刷新持久化和移动端。

## 独立部署

技术结构：React + TypeScript + Vite / Express / Node 内置 SQLite / 本地文件存储。适合单实例、小团队使用；**不要将同一数据卷挂载到多实例或网络文件系统**。代码与运行数据分离。

```bash
npm ci
npm run build
npm run user:create -- --username admin --name 管理员
npm start
# 同一个端口3188同时提供网页和API。
```

正式环境应在 HTTPS 反向代理后运行，设置 `NODE_ENV=production`、`COOKIE_SECURE=true`。`HOST` 默认 `127.0.0.1`；只有明确需要容器或代理连接时才改为 `0.0.0.0`。

### Docker

```bash
docker compose build
docker compose run --rm rectify npm run user:create -- --username admin --name 管理员
docker compose up -d
```

Compose 默认只映射到本机 `127.0.0.1:3188`，供本地使用或反向代理接入。默认 `COOKIE_SECURE=false` 仅为本机 HTTP 访问；公开 HTTPS 部署时必须设置 `COOKIE_SECURE=true`。应用数据在命名卷 `rectify-data` 中，容器更新不会删除；不要执行 `docker compose down -v`，否则会删除数据卷。

示例反向代理配置（将域名改为自己的域名，另行安装并配置 Caddy）：

```caddyfile
issues.example.com {
    reverse_proxy 127.0.0.1:3188
}
```

若恰好经过一层可信反向代理，设置 `TRUST_PROXY=1`；不要在后端可被绕过代理直接访问时盲目启用。

### 配置

| 环境变量 | 默认 | 用途 |
|---|---|---|
| `HOST` | `127.0.0.1` | 后端监听地址 |
| `PORT` | `3188` | 后端与构建后网页端口 |
| `DATA_DIR` | `./data` | SQLite 与上传文件存储位置 |
| `NODE_ENV` | 未设置 | `production` 启用正式安全响应头 |
| `COOKIE_SECURE` | 跟随正式模式 | HTTPS 部署须为 `true`；本机 HTTP 才可为 `false` |
| `TRUST_PROXY` | `0` | 可信代理层数 |
| `RECTIFY_BOOTSTRAP_PASSWORD` | 无 | 仅用户创建命令使用；自动化时通过安全环境注入，不写入命令行或仓库 |

环境变量需通过终端、进程管理器或容器传入；项目不自动读取 `.env`。

## 数据与安全边界

- 无默认密码，无公开注册；密码使用 scrypt 哈希，会话使用 HttpOnly / SameSite Cookie，数据库只保存令牌摘要。
- API 和图片下载都要求登录；写操作要求同源客户端的自定义请求头，不开放跨域 CORS。
- 登录与上传有限流；图片重新解码后保存，不接受 SVG、HTML、任意文件，也不信任原始文件名。
- 项目可归档，不直接删除；图片删除需确认且不可恢复，请定期备份。
- 备份需**停止应用后完整复制数据目录或数据卷**（包含 SQLite 的 WAL/SHM 文件和 uploads），恢复也需停机。不建议仅复制运行中的 `rectify.db`。
- 数据与图片无自动保留期限；容量管理、备份、HTTPS、系统补丁由部署方负责。
- 暂不包含邮件通知、公开分享、第三方登录、客户级隔离、复杂审批、Excel 导入与多副本部署。

## 目录

```text
src/          网页与交互
server/       API、登录、SQLite、图片处理
shared/       类型与状态定义
scripts/      开发与管理员创建命令
tests/        API 与浏览器回归
data/         运行数据（忽略，不提交）
```
