export const ISSUE_TYPES = [
  "问题缺陷",
  "新增功能",
  "体验优化",
  "其他",
] as const;
export const STATUSES = ["待处理", "处理中", "待复验", "已关闭"] as const;
export const PRIORITIES = ["普通", "重要", "紧急"] as const;
export const VERIFICATIONS = ["未复验", "通过", "不通过"] as const;
export interface User {
  id: string;
  username: string;
  name: string;
  role: "admin" | "member";
}
export interface Project {
  id: string;
  name: string;
  description: string;
  archived: number;
  created_at: string;
  issue_count: number;
  open_count: number;
}
export interface Feature {
  id: string;
  project_id: string;
  name: string;
}
export interface Attachment {
  id: string;
  issue_id: string;
  name: string;
  size: number;
  created_at: string;
}
export interface Issue {
  source_system: string | null;
  reporter_name: string | null;
  source_path: string | null;
  id: string;
  number: number;
  project_id: string;
  feature_id: string;
  feature_name: string;
  title: string;
  description: string;
  type: (typeof ISSUE_TYPES)[number];
  status: (typeof STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string;
  resolution: string;
  verification: (typeof VERIFICATIONS)[number];
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  attachment_count: number;
}
export interface Activity {
  id: string;
  actor_name: string;
  message: string;
  created_at: string;
}
export interface IssueDetail extends Issue {
  attachments: Attachment[];
  activities: Activity[];
}
