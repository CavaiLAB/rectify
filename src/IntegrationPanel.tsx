import { useEffect, useState } from "react";
import { api, json } from "./api";
interface Integration {
  id: string;
  name: string;
  key_hint: string;
  enabled: number;
  last_used_at: string | null;
}
export function IntegrationPanel({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  const [items, setItems] = useState<Integration[]>([]);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function refresh() {
    setItems(await api<Integration[]>(`/projects/${projectId}/integrations`));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [projectId]);
  async function create() {
    if (
      !window.confirm(
        "创建仅用于此项目的服务端提交凭据？请勿把凭据放入浏览器或公开仓库。",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ api_key: string }>(
        `/projects/${projectId}/integrations`,
        json("POST", { name }),
      );
      setKey(result.api_key);
      setCopied(false);
      setName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(item: Integration) {
    if (
      !window.confirm(
        `停用“${item.name}”？使用此凭据的系统将不能继续提交，历史问题保留。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/projects/${projectId}/integrations/${item.id}/revoke`,
        json("POST", {}),
      );
      setKey("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-body">
      <div className="info-note">
        外部系统只负责提交反馈，责任人和整改安排在工作台内维护。凭据绑定当前项目，仅允许读取功能项和提交问题。
      </div>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
      <div className="inline-form">
        <input
          aria-label="接入系统名称"
          placeholder="例如：LM 客户反馈"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          disabled={busy || archived}
        />
        <button
          className="button primary"
          disabled={busy || archived || !name.trim() || !!key}
          onClick={create}
        >
          创建接入
        </button>
      </div>
      {key && (
        <section className="integration-secret">
          <strong>请立即保存：完整凭据仅显示这一次</strong>
          <input aria-label="新接入凭据" type="text" readOnly value={key} />
          <div className="inline-form">
            <button
              className="button small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(key);
                  setCopied(true);
                } catch {
                  setError("无法写入剪贴板，请选中文本手动复制");
                }
              }}
            >
              {copied ? "已复制" : "复制凭据"}
            </button>
            <button className="text-button" onClick={() => setKey("")}>
              已保存，隐藏凭据
            </button>
          </div>
          <p className="field-hint">
            仅填入 LM 服务端配置。不要放入网页、URL
            或聊天记录。丢失时停用旧凭据并重新创建。
          </p>
        </section>
      )}
      <div className="features-list">
        {items.map((item) => (
          <div key={item.id}>
            <span>
              {item.name}
              <small>
                {item.key_hint} · {item.enabled ? "启用" : "已停用"}
              </small>
            </span>
            {!!item.enabled && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => revoke(item)}
              >
                停用
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="field-hint">
        服务端接口：<code>GET /api/external/v1/features</code>
        <br />
        <code>POST /api/external/v1/issues</code>
        <br />
        完整请求格式见仓库的 docs/integrations.md。客户无需注册或登录 Rectify。
      </div>
    </div>
  );
}
