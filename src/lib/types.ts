export type Role = "owner" | "admin" | "lead" | "employee";

export type IssueStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type ProjectStatus = "active" | "paused" | "archived";

export const ISSUE_STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "review", "done"];
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_color: string;
  created_at: string;
  requested_role: Extract<Role, "lead" | "employee">;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
}

export interface Session {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_company: boolean;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  key: string;
  description: string;
  status: ProjectStatus;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  issue_number: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assignee_id: string | null;
  reporter_id: string;
  parent_id: string | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  order: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentDoc {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface Activity {
  id: string;
  workspace_id: string;
  user_id: string | null;
  action: string;
  entity_type: "workspace" | "project" | "issue" | "document" | "member" | "comment" | "calendar_event";
  entity_id: string;
  summary: string;
  created_at: string;
}

export type SubmissionStatus = "pending" | "submitted" | "approved" | "rejected";

export interface IssueAssignment {
  id: string;
  issue_id: string;
  user_id: string;
  assigned_by: string;
  note: string;
  due_date: string | null;
  status: SubmissionStatus;
  submission_text: string;
  submit_count: number;
  resubmit_count: number;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionAttachment {
  id: string;
  assignment_id: string;
  filename: string;
  content_type: string;
  size: number;
  data_url: string;
  uploaded_by: string;
  uploaded_at: string;
}

export type CalendarEventVisibility = "public" | "private" | "team";

export interface CalendarEvent {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string;
  meeting_link: string;
  organizer_id: string;
  attendees: string[];
  visibility: CalendarEventVisibility;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  participant_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_by: string[];
  created_at: string;
}

export interface DB {
  users: User[];
  password_credentials: { user_id: string; password_hash: string }[];
  sessions: Session[];
  workspaces: Workspace[];
  workspace_members: WorkspaceMember[];
  projects: Project[];
  issues: Issue[];
  issue_assignments: IssueAssignment[];
  submission_attachments: SubmissionAttachment[];
  comments: Comment[];
  documents: DocumentDoc[];
  calendar_events: CalendarEvent[];
  conversations: Conversation[];
  messages: Message[];
  notifications: Notification[];
  activities: Activity[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  role: Role;
  is_company: boolean;
  project_count: number;
  member_count: number;
  created_at: string;
}
