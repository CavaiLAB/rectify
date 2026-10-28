# 外部系统反馈接入

## 客户提交与内部处理分开

客户只提交功能项、标题、问题描述、问题类型和多张图片，不填写责任人、优先级、计划日期或处理状态。反馈默认为「待处理 / 未分配」。处理人员在 Rectify 内部分配、整改和复验。

LM 通过服务端 API，在顶部嵌入原生「问题反馈」弹窗。客户保持 LM 登录状态，不需要注册 Rectify 账号，也不进入管理后台。这是页面组件集成，不是把整个后台放入 iframe。

## 接入步骤

1. 在 Rectify 创建项目和功能项。
2. 管理员进入该项目 → 外部接入 → 输入系统名称 → 创建接入。
3. 将仅显示一次的凭据放入调用方**服务端**安全配置。不放入前端、URL、Git、日志或截图。
4. 浏览器提交到自己的后端；后端验证登录、填写提交人身份，再调用下述接口。
5. 正式接入使用 HTTPS。不同客户如需项目隔离，为各项目分别创建凭据。

凭据只允许列出绑定项目的功能项和提交问题；无权查看问题清单、内部留言、责任人或上传后的图片，也不能新建功能项。管理员可停用凭据；项目归档后不再接受外部反馈，历史问题保留。

## 接口契约 v1

统一请求头：`Authorization: Bearer <项目专用凭据>`。不使用后台 Cookie，不开放浏览器跨域 CORS。

### GET /api/external/v1/features

返回：

```json
{
  "project_name": "示例项目",
  "features": [{ "id": "功能项UUID", "name": "报表管理" }]
}
```

### POST /api/external/v1/issues

请求头还需 `Idempotency-Key`：8–100位字母、数字、下划线或横线。同一次提交重试复用此标识与内容；内容改变后生成新标识。

使用 `multipart/form-data`：`data` 为以下 JSON 文本，`images` 为可重复的图片字段。支持 PNG/JPG/WebP，最多6张，单张8MB、2000万像素以内。

```json
{
  "feature_id": "功能项UUID",
  "title": "问题标题",
  "description": "问题描述",
  "type": "问题缺陷",
  "reporter_id": "调用系统已认证的用户ID",
  "reporter_name": "提交人姓名",
  "source_path": "/lab/report"
}
```

`type` 可为问题缺陷、新增功能、体验优化、其他，默认问题缺陷。`reporter_id` / `reporter_name` / `source_path` 可省略。提交人由调用方后端从已验证身份获取，不信任浏览器声明的身份。页面路径只传 pathname，不传查询参数、片段、Token 或业务数据。

`project_id`、`assignee_id`、`priority`、`status`、`due_date` 等额外字段会被拒绝。项目从凭据确定。无图片时也可发送 `application/json`。

首次成功返回201，同一标识和相同内容重试返回200，均只返回回执：

```json
{ "id": "问题UUID", "number": 7, "created_at": "2026-10-28T00:00:00.000Z" }
```

回执不是访问授权，不提供凭回执读取内部问题的接口。图片和跟进记录只可在内部工作台查看。

错误：400输入无效、401凭据无效或停用、409项目归档或标识用于不同内容、429限流。每个接入每分钟最多30次提交，同一来源IP每分钟最多180次外部请求。超时可携带原内容和原标识重试。

## 宿主页面嵌入

- 业务页提供「问题反馈」按钮，打开原生弹窗，不跳转整改后台。
- 功能项由后端代理读取，可按当前菜单尝试预选。
- 监听表单区域 `paste` 事件，读取 `event.clipboardData.items` 的图片，支持多张；普通文字粘贴不拦截。不主动读取剪贴板或自动截图。
- 多选、拖拽、粘贴走同一校验；提交失败保留内容，成功显示回执。
- 未修改内容的重试保持请求标识；文字、选项或附件变动后换新标识。
- 不将接入凭据、管理员账号或内部数据交给客户浏览器。

LM 实现位于该仓库的 `web/src/layouts/default/feature/FeedbackModal.vue` 与 `api/src/application/Poxiao.API.Entry/Integrations/RectifyFeedbackClient.cs`。其他系统按同一契约接入，不依赖 LM 数据库。

## 更新与存储

首次启动只在 Rectify 的 SQLite 中新增 `integrations` 和 `external_submissions` 两张表；原有项目、问题、用户和图片不重写。凭据仅存 SHA-256 摘要。更新前按 README 停机备份完整数据目录。
