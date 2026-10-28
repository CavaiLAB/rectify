import {
  cloneElement,
  useId,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Folder,
  FolderPlus,
  ImagePlus,
  Layers3,
  LayoutGrid,
  ListFilter,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, json } from "./api";
import { IntegrationPanel } from "./IntegrationPanel";
import { pastedImages } from "./images";
import {
  ISSUE_TYPES,
  PRIORITIES,
  STATUSES,
  VERIFICATIONS,
  type Attachment,
  type Feature,
  type Issue,
  type IssueDetail,
  type Project,
  type User,
} from "../shared/types";

const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const initials = (value: string) => value.trim().slice(0, 1);
function statusClass(status: string) {
  return ["待处理", "处理中", "待复验", "已关闭"].indexOf(status);
}
function Badge({
  value,
  kind = "status",
}: {
  value: string;
  kind?: "status" | "type" | "priority";
}) {
  return (
    <span
      className={`badge ${kind} ${kind === "status" ? `status-${statusClass(value)}` : kind === "type" ? `type-${ISSUE_TYPES.indexOf(value as (typeof ISSUE_TYPES)[number])}` : value === "紧急" ? "urgent" : value === "重要" ? "important" : "normal"}`}
    >
      {kind === "status" && <span className="status-dot" />}
      {value}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  subtitle?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="关闭弹窗"
          type="button"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function ErrorNote({ message }: { message: string }) {
  return message ? (
    <div className="error-note" role="alert">
      {message}
    </div>
  ) : null;
}
function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id })}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <CheckCheck size={24} />
      </span>
      <div>
        Rectify<small>问题整改工作台</small>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [startupError, setStartupError] = useState("");
  useEffect(() => {
    api<{ user: User | null; configured: boolean }>("/auth/session")
      .then((v) => {
        setUser(v.user);
        setConfigured(v.configured);
      })
      .catch((e) => setStartupError(e.message))
      .finally(() => setLoading(false));
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (loading)
    return (
      <div className="loading-page">
        <Loader2 className="spin" /> 正在连接工作台…
      </div>
    );
  if (startupError)
    return (
      <div className="loading-page">
        <ErrorNote message={startupError} />
        <button onClick={() => location.reload()}>重新连接</button>
      </div>
    );
  return user ? (
    <Workspace user={user} onLogout={() => setUser(null)} />
  ) : (
    <Login configured={configured} onLogin={setUser} />
  );
}
function Login({
  configured,
  onLogin,
}: {
  configured: boolean;
  onLogin: (u: User) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>(
        "/auth/login",
        json("POST", data),
      );
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">让每一个问题，都有回应</span>
          <h1>
            把发现的问题，
            <br />
            变成看得见的改进。
          </h1>
          <p>
            从问题登记到整改复验，让需求、责任和进展
            <br className="desktop-only" />
            留在同一处，而不是散落在聊天记录里。
          </p>
          <div className="story-flow">
            <span>
              <Circle size={16} />
              发现
            </span>
            <ChevronRight size={16} />
            <span>
              <Activity size={16} />
              整改
            </span>
            <ChevronRight size={16} />
            <span>
              <CircleCheck size={16} />
              闭环
            </span>
          </div>
        </div>
        <small>项目有边界 · 处理有记录 · 结果可追踪</small>
      </div>
      <div className="login-side">
        <form className="login-card" onSubmit={submit}>
          <div className="login-icon">
            <Layers3 size={26} />
          </div>
          <h2>欢迎回到工作台</h2>
          <p>登录后，与团队一起跟进项目问题。</p>
          <ErrorNote message={error} />
          {!configured && (
            <div className="info-note">
              尚未创建管理员。请先在服务器运行 <code>npm run user:create</code>{" "}
              完成初始化。
            </div>
          )}
          <Field label="账号">
            <input
              name="username"
              autoComplete="username"
              required
              autoFocus
              placeholder="请输入账号"
              maxLength={40}
            />
          </Field>
          <Field label="密码">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="请输入密码"
              maxLength={128}
            />
          </Field>
          <button
            className="button primary full"
            disabled={busy || !configured}
          >
            {busy ? <Loader2 className="spin" size={16} /> : null}登录工作台{" "}
            <ArrowUpRight size={17} />
          </button>
          <div className="login-note">
            <ShieldCheck size={14} />
            仅团队成员可访问项目记录和图片
          </div>
        </form>
      </div>
    </div>
  );
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(true);
  const [issueLoading, setIssueLoading] = useState(false);
  const [error, setError] = useState("");
  const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [featureDialog, setFeatureDialog] = useState(false);
  const [integrationDialog, setIntegrationDialog] = useState(false);
  const [issueDialog, setIssueDialog] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [feature, setFeature] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [toast, setToast] = useState("");
  const project = projects.find((p) => p.id === selected);
  async function loadProjects() {
    setProjects(await api<Project[]>("/projects"));
  }
  function notice(message: string) {
    setToast(message);
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    Promise.all([api<Project[]>("/projects"), api<User[]>("/users")])
      .then(([p, u]) => {
        setProjects(p);
        setMembers(u);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    setSearch("");
    setStatus("");
    setType("");
    setFeature("");
    setOnlyMine(false);
    setIssues([]);
    setFeatures([]);
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setIssueLoading(true);
    setError("");
    Promise.all([
      api<Feature[]>(`/projects/${selected}/features`, {
        signal: controller.signal,
      }),
      api<Issue[]>(`/projects/${selected}/issues`, {
        signal: controller.signal,
      }),
    ])
      .then(([f, i]) => {
        setFeatures(f);
        setIssues(i);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIssueLoading(false);
      });
    return () => controller.abort();
  }, [selected, revision]);
  async function refresh(message?: string) {
    setRevision((v) => v + 1);
    try {
      await loadProjects();
      if (message) notice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const filtered = issues.filter(
    (i) =>
      (!search ||
        `${i.title} ${i.description} ${i.number} ${i.assignee_name ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status || i.status === status) &&
      (!type || i.type === type) &&
      (!feature || i.feature_id === feature) &&
      (!onlyMine || i.assignee_id === user.id),
  );
  const activeProjects = projects.filter((p) => !p.archived);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          团队工作空间 <span>TEAM</span>
        </div>
        <button
          className={`nav-button ${!selected ? "active" : ""}`}
          onClick={() => setSelected(null)}
        >
          <LayoutGrid size={18} />
          所有项目 <span className="nav-count">{projects.length}</span>
        </button>
        <div className="nav-section">
          我的项目
          <button
            className="icon-button"
            aria-label="创建项目"
            onClick={() => setProjectDialog("new")}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="project-nav">
          {activeProjects.map((p) => (
            <button
              key={p.id}
              className={`nav-button project-nav-item ${selected === p.id ? "active" : ""}`}
              onClick={() => setSelected(p.id)}
              title={p.name}
            >
              <span className="project-dot" />
              <span className="ellipsis">{p.name}</span>
              {p.open_count > 0 && (
                <span className="nav-count">{p.open_count}</span>
              )}
            </button>
          ))}
          {!activeProjects.length && (
            <p className="nav-empty">创建项目，开始记录问题</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-button" onClick={() => setSettings(true)}>
            <Users size={18} />
            团队与账号
          </button>
          <div className="profile">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin" ? "工作空间管理员" : "团队成员"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={async () => {
                try {
                  await api("/auth/logout", json("POST", {}));
                  onLogout();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{project?.name ?? "所有项目"}</strong>
          </div>
          <span className="private-label">
            <ShieldCheck size={14} />
            团队内可见
          </span>
          <div className="mobile-account-actions">
            <button
              className="icon-button"
              aria-label="团队与账号"
              onClick={() => setSettings(true)}
            >
              <Users size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={async () => {
                try {
                  await api("/auth/logout", json("POST", {}));
                  onLogout();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <ErrorNote message={error} />
          {busy ? (
            <div className="empty-state">
              <Loader2 className="spin" />
              正在加载项目…
            </div>
          ) : !project ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PROJECTS</div>
                  <h1>
                    让项目问题，有序推进<span className="heading-dot">。</span>
                  </h1>
                  <p>按项目集中记录问题、需求与改进，跟进每一次处理。</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setProjectDialog("new")}
                >
                  <Plus size={17} />
                  创建项目
                </button>
              </div>
              <div className="overview-strip">
                <span>
                  <strong>{activeProjects.length}</strong>进行中项目
                </span>
                <span>
                  <strong>
                    {projects.reduce((s, p) => s + p.open_count, 0)}
                  </strong>
                  待闭环问题
                </span>
                <span>
                  <strong>{members.length}</strong>团队成员
                </span>
              </div>
              <div className="section-heading">
                <h2>
                  项目列表 <span>{projects.length}</span>
                </h2>
                <span>项目记录与图片仅对登录成员开放</span>
              </div>
              {!projects.length ? (
                <div className="empty-state large">
                  <div className="empty-icon">
                    <FolderPlus size={32} />
                  </div>
                  <h2>从第一个项目开始</h2>
                  <p>
                    创建项目、设置功能项，就可以邀请团队一起记录和整改问题。
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setProjectDialog("new")}
                  >
                    <Plus size={17} />
                    创建第一个项目
                  </button>
                </div>
              ) : (
                <div className="project-grid">
                  {projects.map((p) => (
                    <article
                      className={`project-card ${p.archived ? "archived" : ""}`}
                      key={p.id}
                    >
                      <div className="project-card-top">
                        <span className="project-icon">
                          <Folder size={23} />
                        </span>
                        <span
                          className={`project-state ${p.archived ? "" : "running"}`}
                        >
                          {p.archived ? "已归档" : "进行中"}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`编辑项目 ${p.name}`}
                          onClick={() => setProjectDialog(p)}
                        >
                          <MoreHorizontal size={20} />
                        </button>
                      </div>
                      <button
                        className="project-title"
                        onClick={() => setSelected(p.id)}
                      >
                        {p.name}
                        <ArrowUpRight size={18} />
                      </button>
                      <p>
                        {p.description ||
                          "暂无项目说明。进入项目，开始记录问题。"}
                      </p>
                      <div className="project-card-foot">
                        <span>
                          {p.issue_count} 个问题 <i /> {p.open_count} 个待闭环
                        </span>
                        <button
                          onClick={() => setSelected(p.id)}
                          aria-label={`进入项目 ${p.name}`}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-square" />
                    项目整改清单 {project.archived ? " / 已归档" : ""}
                  </div>
                  <h1>{project.name}</h1>
                  <p>
                    {project.description ||
                      "集中记录、明确责任，让每一个问题都有处理结果。"}
                  </p>
                </div>
                <div className="heading-actions">
                  {user.role === "admin" && (
                    <button
                      className="button"
                      onClick={() => setIntegrationDialog(true)}
                    >
                      外部接入
                    </button>
                  )}
                  <button
                    className="button"
                    onClick={() => setProjectDialog(project)}
                  >
                    <Settings2 size={16} />
                    项目设置
                  </button>
                  <button
                    className="button primary"
                    disabled={!!project.archived}
                    onClick={() => setIssueDialog("new")}
                  >
                    <Plus size={17} />
                    登记问题
                  </button>
                </div>
              </div>
              {!!project.archived && (
                <div className="info-note">
                  项目已归档，记录仍可查看。需要继续处理时，请在项目设置中恢复。
                </div>
              )}
              <div className="stats-grid">
                {STATUSES.map((s, index) => {
                  const Icon = [Circle, Activity, Clock3, CircleCheck][index];
                  return (
                    <button
                      className={`stat-card stat-${index} ${status === s ? "selected" : ""}`}
                      key={s}
                      onClick={() => setStatus(status === s ? "" : s)}
                    >
                      <div>
                        <span>{s}</span>
                        <strong>
                          {issues.filter((i) => i.status === s).length}
                        </strong>
                      </div>
                      <span className="stat-icon">
                        <Icon size={22} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <section className="issues-section">
                <div className="section-heading">
                  <h2>
                    问题清单 <span>{issues.length}</span>
                  </h2>
                  <div className="section-actions">
                    <button
                      className="text-button"
                      onClick={() => setFeatureDialog(true)}
                    >
                      <Layers3 size={15} />
                      功能项管理
                    </button>
                    <button
                      className="text-button"
                      disabled={!filtered.length}
                      onClick={() => downloadCsv(filtered, project.name)}
                    >
                      <ArrowDownToLine size={15} />
                      导出清单
                    </button>
                  </div>
                </div>
                <div className="filterbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="搜索问题"
                      placeholder="搜索问题、编号或责任人"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="filter-selects">
                    <select
                      aria-label="筛选功能项"
                      value={feature}
                      onChange={(e) => setFeature(e.target.value)}
                    >
                      <option value="">全部功能项</option>
                      {features.map((f) => (
                        <option value={f.id} key={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="筛选问题类型"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      <option value="">全部类型</option>
                      {ISSUE_TYPES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <select
                      aria-label="筛选状态"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">全部状态</option>
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      className={`filter-mine ${onlyMine ? "selected" : ""}`}
                      onClick={() => setOnlyMine(!onlyMine)}
                      aria-pressed={onlyMine}
                    >
                      <ListFilter size={15} />
                      我负责的
                    </button>
                  </div>
                </div>
                {issueLoading ? (
                  <div className="empty-state">
                    <Loader2 className="spin" />
                    正在加载问题…
                  </div>
                ) : !filtered.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <CheckCheck size={30} />
                    </div>
                    <h3>
                      {issues.length
                        ? "没有符合条件的问题"
                        : "问题不遗漏，改进有记录"}
                    </h3>
                    <p>
                      {issues.length
                        ? "试试调整筛选条件或搜索关键词。"
                        : "登记发现的问题或新增需求，附上截图，让团队快速了解情况。"}
                    </p>
                    {!issues.length && !project.archived && (
                      <button
                        className="button"
                        onClick={() => setIssueDialog("new")}
                      >
                        <Plus size={16} />
                        登记第一条问题
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="issue-table">
                      <thead>
                        <tr>
                          <th>编号 / 问题</th>
                          <th>功能项</th>
                          <th>类型</th>
                          <th>状态</th>
                          <th>责任人</th>
                          <th>计划完成</th>
                          <th aria-label="查看" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((i) => (
                          <tr key={i.id}>
                            <td>
                              <button
                                className="issue-title"
                                onClick={() => setIssueDialog(i.id)}
                              >
                                <span className="issue-number">
                                  #{String(i.number).padStart(3, "0")}
                                </span>
                                <strong>{i.title}</strong>
                              </button>
                              <div className="issue-meta">
                                <Badge value={i.priority} kind="priority" />
                                {i.attachment_count > 0 && (
                                  <span>
                                    <ImagePlus size={12} />
                                    {i.attachment_count}
                                  </span>
                                )}
                                <span>更新于 {dateTime(i.updated_at)}</span>
                              </div>
                            </td>
                            <td>
                              <span className="feature-cell">
                                {i.feature_name}
                              </span>
                            </td>
                            <td>
                              <Badge value={i.type} kind="type" />
                            </td>
                            <td>
                              <Badge value={i.status} />
                            </td>
                            <td>
                              <span className="assignee-cell">
                                {i.assignee_name ? (
                                  <>
                                    <span className="avatar mini">
                                      {initials(i.assignee_name)}
                                    </span>
                                    {i.assignee_name}
                                  </>
                                ) : (
                                  <span className="muted">未分配</span>
                                )}
                              </span>
                            </td>
                            <td
                              className={
                                i.status !== "已关闭" &&
                                i.due_date &&
                                i.due_date <
                                  new Date().toLocaleDateString("sv-SE")
                                  ? "overdue"
                                  : "muted"
                              }
                            >
                              {i.due_date || "—"}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`查看问题 ${i.number}`}
                                onClick={() => setIssueDialog(i.id)}
                              >
                                <ChevronRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="list-footer">
                  显示 {filtered.length} 条，共 {issues.length} 条
                  <span>新增功能仅作需求登记，实施范围另行确认</span>
                </div>
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>Rectify / 问题整改工作台</span>
            <span>每一个问题，都值得被认真解决。</span>
          </footer>
        </main>
      </div>
      {projectDialog && (
        <ProjectDialog
          project={projectDialog === "new" ? undefined : projectDialog}
          onClose={() => setProjectDialog(null)}
          onSaved={async (id) => {
            await loadProjects();
            setSelected(id);
            setProjectDialog(null);
            setRevision((v) => v + 1);
            notice("项目已保存");
          }}
        />
      )}
      {settings && (
        <TeamDialog
          user={user}
          members={members}
          onClose={() => setSettings(false)}
          onUpdate={async () => setMembers(await api<User[]>("/users"))}
          onLogout={onLogout}
        />
      )}
      {featureDialog && project && (
        <FeaturesDialog
          project={project}
          features={features}
          onClose={() => setFeatureDialog(false)}
          onUpdate={async () => {
            setFeatures(
              await api<Feature[]>(`/projects/${project.id}/features`),
            );
            await refresh();
          }}
        />
      )}
      {integrationDialog && project && (
        <Modal
          title="外部系统接入"
          subtitle={project.name}
          onClose={() => setIntegrationDialog(false)}
        >
          <IntegrationPanel
            projectId={project.id}
            archived={!!project.archived}
          />
        </Modal>
      )}
      {issueDialog && project && (
        <IssueDialog
          id={issueDialog}
          project={project}
          members={members}
          features={features}
          onFeatures={setFeatures}
          onClose={() => setIssueDialog(null)}
          onSaved={async () => {
            setIssueDialog(null);
            await refresh("问题已保存");
          }}
        />
      )}
      <div role="status" className={`toast ${toast ? "visible" : ""}`}>
        <Check size={17} />
        {toast}
      </div>
    </div>
  );
}

function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = {
        name: values.get("name"),
        description: values.get("description"),
        archived: values.get("archived") === "on",
        features: String(values.get("features") ?? "")
          .split(/\n/)
          .map((v) => v.trim())
          .filter(Boolean),
      };
      const result = await api<Project>(
        project ? `/projects/${project.id}` : "/projects",
        json(project ? "PATCH" : "POST", data),
      );
      await onSaved(project?.id ?? result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "项目设置" : "创建项目"}
      subtitle="把同一项目的问题与需求集中在一起。"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorNote message={error} />
          <Field label="项目名称 *">
            <input
              autoFocus
              required
              name="name"
              defaultValue={project?.name}
              maxLength={80}
              placeholder="例如：生产管理系统验收"
            />
          </Field>
          <Field label="项目说明">
            <textarea
              name="description"
              rows={3}
              maxLength={1000}
              defaultValue={project?.description}
              placeholder="简单说明项目范围或本次验收目标"
            />
          </Field>
          {!project && (
            <Field label="初始功能项（每行一个，可稍后添加）">
              <textarea
                name="features"
                rows={4}
                maxLength={8000}
                placeholder={"用户管理\n数据报表\n采集客户端"}
              />
            </Field>
          )}
          {project && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="archived"
                defaultChecked={!!project.archived}
              />
              归档项目（保留数据，暂停新增和修改问题）
            </label>
          )}
          <div className="field-hint">
            同一工作空间的所有成员均可查看和维护此项目。
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="button"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "正在保存…" : project ? "保存设置" : "创建项目"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FeaturesDialog({
  project,
  features,
  onClose,
  onUpdate,
}: {
  project: Project;
  features: Feature[];
  onClose: () => void;
  onUpdate: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        `/projects/${project.id}/features${editing ? `/${editing}` : ""}`,
        json(editing ? "PATCH" : "POST", { name: value }),
      );
      await onUpdate();
      setValue("");
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="功能项管理"
      subtitle="功能项只属于当前项目；登记问题时可下拉选择。"
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNote message={error} />
        <form className="inline-form" onSubmit={submit}>
          <input
            aria-label="功能项名称"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={80}
            placeholder="输入功能项名称"
            disabled={!!project.archived}
          />
          <button
            className="button primary"
            disabled={busy || !!project.archived}
          >
            {editing ? "保存" : "添加"}
          </button>
          {editing && (
            <button
              type="button"
              className="icon-button"
              aria-label="取消重命名"
              onClick={() => {
                setEditing(null);
                setValue("");
              }}
            >
              <X size={16} />
            </button>
          )}
        </form>
        <div className="features-list">
          {features.map((f) => (
            <div key={f.id}>
              <span>
                <Layers3 size={16} />
                {f.name}
              </span>
              <button
                className="icon-button"
                aria-label={`重命名 ${f.name}`}
                disabled={!!project.archived}
                onClick={() => {
                  setEditing(f.id);
                  setValue(f.name);
                }}
              >
                <Pencil size={15} />
              </button>
            </div>
          ))}
          {!features.length && (
            <p className="muted">尚无功能项，可从上方添加。</p>
          )}
        </div>
        <p className="field-hint">
          重命名后，已有问题会同步显示新名称。为保留历史记录，暂不提供删除。
        </p>
      </div>
    </Modal>
  );
}

function TeamDialog({
  user,
  members,
  onClose,
  onUpdate,
  onLogout,
}: {
  user: User;
  members: User[];
  onClose: () => void;
  onUpdate: () => Promise<void>;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState("members");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(
        tab === "password" ? "/auth/password" : "/users",
        json("POST", Object.fromEntries(new FormData(form))),
      );
      if (tab === "password") onLogout();
      else {
        await onUpdate();
        form.reset();
        setSuccess("成员已添加，请通过安全渠道告知账号和密码。");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="团队与账号"
      subtitle="一个工作空间，共享项目；不开放公开注册。"
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="tabs">
          <button
            className={tab === "members" ? "active" : ""}
            onClick={() => {
              setTab("members");
              setError("");
            }}
          >
            团队成员
          </button>
          <button
            className={tab === "password" ? "active" : ""}
            onClick={() => {
              setTab("password");
              setError("");
            }}
          >
            修改密码
          </button>
        </div>
        <ErrorNote message={error} />
        {success && <div className="info-note">{success}</div>}
        {tab === "members" ? (
          <>
            <div className="member-list">
              {members.map((m) => (
                <div key={m.id}>
                  <span className="avatar">{initials(m.name)}</span>
                  <div>
                    <strong>{m.name}</strong>
                    <small>{m.username}</small>
                  </div>
                  <span className="muted">
                    {m.role === "admin" ? "管理员" : "成员"}
                  </span>
                </div>
              ))}
            </div>
            {user.role === "admin" && (
              <form onSubmit={submit} className="member-form">
                <h3>添加成员</h3>
                <div className="form-grid">
                  <Field label="姓名 *">
                    <input required name="name" maxLength={50} />
                  </Field>
                  <Field label="账号 *">
                    <input
                      required
                      name="username"
                      pattern="[a-zA-Z0-9_.\-]{3,40}"
                      autoComplete="off"
                      placeholder="3–40位英文或数字"
                    />
                  </Field>
                  <Field label="初始密码 *">
                    <input
                      required
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      placeholder="至少12位"
                    />
                  </Field>
                  <Field label="角色">
                    <select name="role">
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </Field>
                </div>
                <button className="button primary" disabled={busy}>
                  添加成员
                </button>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="原密码">
              <input
                required
                name="current"
                type="password"
                autoComplete="current-password"
                maxLength={128}
              />
            </Field>
            <Field label="新密码（至少12位）">
              <input
                required
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
              />
            </Field>
            <p className="field-hint">修改后将退出所有设备，需要重新登录。</p>
            <button className="button primary" disabled={busy}>
              修改密码并退出
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function IssueDialog({
  id,
  project,
  members,
  features,
  onFeatures,
  onClose,
  onSaved,
}: {
  id: string;
  project: Project;
  members: User[];
  features: Feature[];
  onFeatures: (f: Feature[]) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = id === "new";
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [featureName, setFeatureName] = useState("");
  const [addFeature, setAddFeature] = useState(false);
  const [comment, setComment] = useState("");
  const blank = {
    title: "",
    description: "",
    feature_id: "",
    type: "问题缺陷",
    priority: "普通",
    status: "待处理",
    assignee_id: "",
    due_date: "",
    resolution: "",
    verification: "未复验",
  };
  const [values, setValues] = useState(blank);
  const [dirty, setDirty] = useState(false);
  const readOnly = !!project.archived;
  const change = (key: keyof typeof blank, value: string) => {
    setDirty(true);
    setValues((v) => ({ ...v, [key]: value }));
  };
  function close() {
    if (busy) return;
    if (!dirty || window.confirm("尚有未保存的内容，确定关闭吗？")) onClose();
  }
  useEffect(() => {
    if (isNew) return;
    const controller = new AbortController();
    api<IssueDetail>(`/issues/${id}`, { signal: controller.signal })
      .then((d) => {
        setDetail(d);
        setValues({
          title: d.title,
          description: d.description,
          feature_id: d.feature_id,
          type: d.type,
          priority: d.priority,
          status: d.status,
          assignee_id: d.assignee_id ?? "",
          due_date: d.due_date,
          resolution: d.resolution,
          verification: d.verification,
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, isNew]);
  async function createFeature() {
    setBusy(true);
    setError("");
    try {
      const f = await api<Feature>(
        `/projects/${project.id}/features`,
        json("POST", { name: featureName }),
      );
      onFeatures(await api<Feature[]>(`/projects/${project.id}/features`));
      change("feature_id", f.id);
      setFeatureName("");
      setAddFeature(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectFiles(newFiles: File[]) {
    const next = [...files, ...newFiles];
    if (next.length + (detail?.attachments.length ?? 0) > 6) {
      setError("每个问题最多6张图片");
      return;
    }
    if (
      next.some(
        (f) =>
          f.size > 8 * 1024 * 1024 ||
          !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      setError("请上传 PNG、JPG 或 WebP 图片，每张不超过8MB");
      return;
    }
    setError("");
    setFiles(next);
    setDirty(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = { ...values, assignee_id: values.assignee_id || null };
      if (isNew) {
        const form = new FormData();
        form.append(
          "data",
          JSON.stringify({
            feature_id: data.feature_id,
            description: data.description,
            type: data.type,
          }),
        );
        files.forEach((f) => form.append("images", f));
        await api(`/projects/${project.id}/issues`, {
          method: "POST",
          body: form,
        });
      } else {
        const next = await api<IssueDetail>(
          `/issues/${id}`,
          json("PATCH", { ...data, version: detail!.version }),
        );
        setDetail(next);
        if (files.length) {
          const form = new FormData();
          files.forEach((f) => form.append("images", f));
          const withImages = await api<IssueDetail>(
            `/issues/${id}/attachments`,
            { method: "POST", body: form },
          );
          setDetail(withImages);
          setFiles([]);
        }
      }
      setDirty(false);
      await onSaved();
    } catch (e) {
      setError(
        (e as Error).message +
          (!isNew ? "（如正文已保存而图片失败，可保留弹窗重试。）" : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  function mergeActivity(next: IssueDetail) {
    // 跟进操作不替换正在编辑的正文；若他人同时修改，保留旧版本以触发冲突检查。
    setDetail((previous) =>
      previous
        ? {
            ...previous,
            attachments: next.attachments,
            activities: next.activities,
            version:
              next.version === previous.version + 1
                ? next.version
                : previous.version,
          }
        : next,
    );
  }
  async function removeAttachment(attachment: Attachment) {
    if (!window.confirm(`移除图片“${attachment.name}”？此操作无法撤销。`))
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/attachments/${attachment.id}`, { method: "DELETE" });
      mergeActivity(await api<IssueDetail>(`/issues/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function postComment() {
    setBusy(true);
    setError("");
    try {
      mergeActivity(
        await api<IssueDetail>(
          `/issues/${id}/comments`,
          json("POST", { message: comment }),
        ),
      );
      setComment("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={
        isNew
          ? "登记问题"
          : `问题 #${String(detail?.number ?? "").padStart(3, "0")}`
      }
      subtitle={
        isNew
          ? "写清楚发生了什么，团队才能更快开始处理。"
          : `${project.name} · 查看与跟进`
      }
      onClose={close}
    >
      {loading ? (
        <div className="empty-state">
          <Loader2 className="spin" />
          正在读取问题…
        </div>
      ) : (
        <form onSubmit={save}>
          <div
            className="modal-body issue-editor"
            onPaste={(event) => {
              if (busy || readOnly) return;
              const images = pastedImages(event.clipboardData);
              if (images.length) {
                event.preventDefault();
                selectFiles(images);
              }
            }}
          >
            <ErrorNote message={error} />
            {detail?.source_system && (
              <div className="info-note">
                来源：{detail.source_system}
                {detail.reporter_name
                  ? ` · 提交人：${detail.reporter_name}`
                  : ""}
                {detail.source_path ? ` · 页面：${detail.source_path}` : ""}
              </div>
            )}
            {(isNew || detail) && (
              <>
                <fieldset disabled={busy || readOnly}>
                  {!isNew && (
                    <Field label="问题标题 *">
                      <input
                        autoFocus
                        required
                        maxLength={120}
                        value={values.title}
                        onChange={(e) => change("title", e.target.value)}
                        placeholder="用一句话说明问题或希望增加的功能"
                      />
                    </Field>
                  )}
                  <div className="form-grid">
                    <Field label="功能项 *">
                      <select
                        required
                        value={values.feature_id}
                        onChange={(e) => change("feature_id", e.target.value)}
                      >
                        <option value="">请选择功能项</option>
                        {features.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="问题类型 *">
                      <select
                        value={values.type}
                        onChange={(e) => change("type", e.target.value)}
                      >
                        {ISSUE_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {!readOnly && (
                    <div className="new-feature">
                      {addFeature ? (
                        <div className="inline-form">
                          <input
                            aria-label="新功能项名称"
                            maxLength={80}
                            value={featureName}
                            onChange={(e) => setFeatureName(e.target.value)}
                            placeholder="输入新的功能项名称"
                          />
                          <button
                            type="button"
                            className="button small"
                            disabled={!featureName.trim()}
                            onClick={createFeature}
                          >
                            添加并选择
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="取消添加功能项"
                            onClick={() => setAddFeature(false)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-button accent"
                          onClick={() => setAddFeature(true)}
                        >
                          <Plus size={14} />
                          没有合适的？添加功能项
                        </button>
                      )}
                    </div>
                  )}
                  {values.type === "新增功能" && (
                    <div className="info-note">
                      本条按新增需求登记。是否实施、范围和时间，由相关人员另行确认。
                    </div>
                  )}
                  <Field label="问题描述 *">
                    <textarea
                      autoFocus={isNew}
                      required
                      rows={4}
                      maxLength={10000}
                      value={values.description}
                      onChange={(e) => change("description", e.target.value)}
                      placeholder={
                        "说明出现的问题、操作步骤或想增加的功能。\n例如：打开报表后，选择日期范围，导出结果与页面不一致。"
                      }
                    />
                  </Field>
                  {isNew && (
                    <p className="field-hint">
                      直接描述问题即可，提交后会自动生成简短标题。
                    </p>
                  )}
                  {!isNew && (
                    <div className="form-grid thirds">
                      <Field label="责任人">
                        <select
                          value={values.assignee_id}
                          onChange={(e) =>
                            change("assignee_id", e.target.value)
                          }
                        >
                          <option value="">暂不分配</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="优先级">
                        <select
                          value={values.priority}
                          onChange={(e) => change("priority", e.target.value)}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="计划完成日期">
                        <input
                          type="date"
                          value={values.due_date}
                          onChange={(e) => change("due_date", e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  <section className="attachment-section">
                    <div className="field-label">
                      图片附件{" "}
                      <span>
                        {files.length + (detail?.attachments.length ?? 0)} / 6
                      </span>
                    </div>
                    <div className="attachments">
                      {detail?.attachments.map((a) => (
                        <div className="attachment" key={a.id}>
                          <a
                            href={`/api/attachments/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={`/api/attachments/${a.id}`}
                              alt={a.name}
                            />
                          </a>
                          <span title={a.name}>{a.name}</span>
                          {!readOnly && (
                            <button
                              type="button"
                              className="remove-image"
                              aria-label={`移除图片 ${a.name}`}
                              onClick={() => removeAttachment(a)}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                      {files.map((f, index) => (
                        <FilePreview
                          file={f}
                          key={`${f.name}-${index}`}
                          remove={() => {
                            setFiles(files.filter((_, i) => i !== index));
                            setDirty(true);
                          }}
                        />
                      ))}
                    </div>
                    {!readOnly && (
                      <label
                        className="upload-zone"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!busy) selectFiles([...e.dataTransfer.files]);
                        }}
                      >
                        <ImagePlus size={23} />
                        <strong>
                          选择多张图片、拖拽，或 Ctrl/Cmd+V 粘贴截图
                        </strong>
                        <span>PNG、JPG、WebP · 单张不超过8MB · 最多6张</span>
                        <input
                          aria-label="上传图片"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          onChange={(e) => {
                            selectFiles([...(e.target.files ?? [])]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </section>
                  {!isNew && (
                    <section className="resolution-section">
                      <h3>
                        <CheckCheck size={18} />
                        整改与复验
                      </h3>
                      <Field label="整改措施 / 处理说明">
                        <textarea
                          rows={3}
                          maxLength={10000}
                          value={values.resolution}
                          onChange={(e) => change("resolution", e.target.value)}
                          placeholder="记录做了哪些处理，以及复验时需要关注什么"
                        />
                      </Field>
                      <div className="form-grid">
                        <Field label="处理状态">
                          <select
                            value={values.status}
                            onChange={(e) => change("status", e.target.value)}
                          >
                            {STATUSES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="复验结果">
                          <select
                            value={values.verification}
                            onChange={(e) =>
                              change("verification", e.target.value)
                            }
                          >
                            {VERIFICATIONS.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <p className="field-hint">
                        填写整改措施后提交复验；复验通过才能关闭。不通过时退回待处理或处理中。
                      </p>
                      {detail?.completed_at && (
                        <p className="field-hint">
                          整改完成时间：{dateTime(detail.completed_at)}
                          （系统自动记录）
                        </p>
                      )}
                    </section>
                  )}
                </fieldset>
                {!isNew && (
                  <section className="activity-section">
                    <h3>
                      <MessageSquare size={17} />
                      跟进记录
                    </h3>
                    {!readOnly && (
                      <div className="inline-form">
                        <input
                          aria-label="跟进留言"
                          value={comment}
                          maxLength={2000}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="补充说明或复验反馈"
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="button small"
                          disabled={busy || !comment.trim()}
                          onClick={postComment}
                        >
                          发送
                        </button>
                      </div>
                    )}
                    <div className="timeline">
                      {detail?.activities.map((a) => (
                        <div key={a.id}>
                          <span className="timeline-dot" />
                          <p>
                            <strong>{a.actor_name}</strong>
                            <time>{dateTime(a.created_at)}</time>
                            <span>{a.message}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <span className="footer-hint">
              {isNew
                ? "提交后默认进入「待处理」"
                : detail
                  ? `登记于 ${dateTime(detail.created_at)}`
                  : ""}
            </span>
            <button
              type="button"
              className="button"
              onClick={close}
              disabled={busy}
            >
              {readOnly ? "关闭" : "取消"}
            </button>
            {!readOnly && (
              <button
                className="button primary"
                disabled={busy || (!isNew && !detail)}
              >
                {busy ? "正在保存…" : isNew ? "提交问题" : "保存修改"}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
function FilePreview({ file, remove }: { file: File; remove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <div className="attachment pending">
      <img src={url || undefined} alt={file.name} />
      <span title={file.name}>{file.name}</span>
      <button
        type="button"
        className="remove-image"
        aria-label={`取消上传 ${file.name}`}
        onClick={remove}
      >
        <X size={13} />
      </button>
    </div>
  );
}
function downloadCsv(issues: Issue[], projectName: string) {
  const safe = (value: unknown) => {
    const text = String(value ?? "");
    return `"${(/^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    [
      "编号",
      "功能项",
      "问题标题",
      "问题类型",
      "问题描述",
      "状态",
      "优先级",
      "责任人",
      "计划完成日期",
      "整改措施",
      "复验结果",
      "整改完成时间",
    ],
  ];
  issues.forEach((i) =>
    rows.push([
      i.number,
      i.feature_name,
      i.title,
      i.type,
      i.description,
      i.status,
      i.priority,
      i.assignee_name,
      i.due_date,
      i.resolution,
      i.verification,
      i.completed_at,
    ]),
  );
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(safe).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[\\/:*?"<>|]/g, "_")}_问题整改清单.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
