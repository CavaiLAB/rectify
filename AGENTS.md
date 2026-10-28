# 项目约定

- 使用中文文案。保持“简单项目整改清单”的定位，不擅自扩成复杂项目管理平台。
- 公开仓库只提交代码、文档和虚构测试夹具；禁止提交数据库、上传图片、真实账号、客户资料和凭据。
- 数据在 `DATA_DIR` 中，测试必须使用独立临时目录；不要访问其他项目数据库。
- 修改 API 时同步前端类型、校验和回归；所有业务 API 和附件必须经过登录验证。
- 所有登录成员共享一个工作空间，不宣称存在项目级隔离。
- 新增文件用 TypeScript；字体优先使用 Microsoft YaHei / 微软雅黑。
- 验证命令：`npm run build`、`npm test`、`npm run test:e2e`、`npm audit --audit-level=high`。
- 提交身份 `cody <idadawn@outlook.com>`；分支 `cody/<topic>`，PR 标题以 `cody:` 开头。CI 全绿后合并并删除分支，回到 main 同步。
