export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "low" | "normal" | "high";

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  position: number;
  assigneeIds: string[];
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  createdAt: string;
};

export type Label = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
};

export type TaskComment = {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
};

export type Activity = {
  id: string;
  taskId: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceSnapshot = {
  tasks: Task[];
  members: TeamMember[];
  labels: Label[];
  comments: TaskComment[];
  activities: Activity[];
};

export const BOARD_COLUMNS: Array<{
  id: TaskStatus;
  title: string;
  shortTitle: string;
  description: string;
}> = [
  {
    id: "todo",
    title: "To Do",
    shortTitle: "Ready",
    description: "Ideas and work ready to start",
  },
  {
    id: "in_progress",
    title: "In Progress",
    shortTitle: "Active",
    description: "Work currently taking shape",
  },
  {
    id: "in_review",
    title: "In Review",
    shortTitle: "Review",
    description: "Waiting for feedback or approval",
  },
  {
    id: "done",
    title: "Done",
    shortTitle: "Complete",
    description: "Finished and ready to celebrate",
  },
];

export const MEMBER_COLORS = [
  "#5B5BD6",
  "#D96C52",
  "#2D8C73",
  "#B6782A",
  "#8A5CB8",
  "#3575A8",
];

export const LABEL_COLORS = [
  "#5B5BD6",
  "#D96C52",
  "#2D8C73",
  "#B6782A",
  "#8A5CB8",
  "#3575A8",
];

export const STATUS_TITLE: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export const DEMO_STORAGE_KEY = "driftboard-demo-workspace-v2";

export function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateAtOffset(days: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function timeAtOffset(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function createDemoWorkspace(): WorkspaceSnapshot {
  const members: TeamMember[] = [
    { id: "member-maya", name: "Maya Chen", color: "#5B5BD6", createdAt: timeAtOffset(-240) },
    { id: "member-jules", name: "Jules Kim", color: "#D96C52", createdAt: timeAtOffset(-230) },
    { id: "member-dev", name: "Dev Patel", color: "#2D8C73", createdAt: timeAtOffset(-220) },
    { id: "member-ana", name: "Ana Silva", color: "#B6782A", createdAt: timeAtOffset(-210) },
  ];

  const labels: Label[] = [
    { id: "label-design", name: "Design", color: "#8A5CB8", createdAt: timeAtOffset(-200) },
    { id: "label-product", name: "Product", color: "#5B5BD6", createdAt: timeAtOffset(-190) },
    { id: "label-bug", name: "Bug", color: "#D96C52", createdAt: timeAtOffset(-180) },
    { id: "label-research", name: "Research", color: "#2D8C73", createdAt: timeAtOffset(-170) },
  ];

  const tasks: Task[] = [
    {
      id: "task-onboarding",
      title: "Polish the onboarding empty state",
      description: "Give first-time users a clear next step and a little momentum.",
      status: "todo",
      priority: "high",
      dueDate: dateAtOffset(1),
      position: 1000,
      assigneeIds: ["member-maya"],
      labelIds: ["label-design", "label-product"],
      createdAt: timeAtOffset(-96),
      updatedAt: timeAtOffset(-8),
    },
    {
      id: "task-metrics",
      title: "Define launch success metrics",
      description: "Align the team on activation, adoption, and retention targets.",
      status: "todo",
      priority: "normal",
      dueDate: dateAtOffset(5),
      position: 2000,
      assigneeIds: ["member-ana", "member-dev"],
      labelIds: ["label-research"],
      createdAt: timeAtOffset(-78),
      updatedAt: timeAtOffset(-12),
    },
    {
      id: "task-keyboard",
      title: "Add keyboard shortcuts to command bar",
      description: "Support quick-create and focus search without reaching for the mouse.",
      status: "todo",
      priority: "low",
      dueDate: null,
      position: 3000,
      assigneeIds: ["member-dev"],
      labelIds: ["label-product"],
      createdAt: timeAtOffset(-64),
      updatedAt: timeAtOffset(-19),
    },
    {
      id: "task-navigation",
      title: "Refine mobile board navigation",
      description: "Make the board feel deliberate on smaller screens with snap points and clearer wayfinding.",
      status: "in_progress",
      priority: "high",
      dueDate: dateAtOffset(-1),
      position: 1000,
      assigneeIds: ["member-jules", "member-maya"],
      labelIds: ["label-design", "label-bug"],
      createdAt: timeAtOffset(-120),
      updatedAt: timeAtOffset(-2),
    },
    {
      id: "task-realtime",
      title: "Wire realtime board updates",
      description: "Subscribe to task changes while preserving optimistic interactions.",
      status: "in_progress",
      priority: "normal",
      dueDate: dateAtOffset(3),
      position: 2000,
      assigneeIds: ["member-dev"],
      labelIds: ["label-product"],
      createdAt: timeAtOffset(-110),
      updatedAt: timeAtOffset(-4),
    },
    {
      id: "task-accessibility",
      title: "Accessibility pass on task details",
      description: "Review focus states, labels, contrast, and keyboard navigation.",
      status: "in_review",
      priority: "high",
      dueDate: dateAtOffset(0),
      position: 1000,
      assigneeIds: ["member-maya", "member-jules"],
      labelIds: ["label-design", "label-bug"],
      createdAt: timeAtOffset(-150),
      updatedAt: timeAtOffset(-1),
    },
    {
      id: "task-copy",
      title: "Approve launch announcement copy",
      description: "Final review for the release note and customer email.",
      status: "in_review",
      priority: "normal",
      dueDate: dateAtOffset(2),
      position: 2000,
      assigneeIds: ["member-ana"],
      labelIds: ["label-product"],
      createdAt: timeAtOffset(-88),
      updatedAt: timeAtOffset(-6),
    },
    {
      id: "task-tokens",
      title: "Publish the interface token library",
      description: "Document the shared palette, type scale, spacing, and surface rules.",
      status: "done",
      priority: "normal",
      dueDate: dateAtOffset(-3),
      position: 1000,
      assigneeIds: ["member-jules"],
      labelIds: ["label-design"],
      createdAt: timeAtOffset(-240),
      updatedAt: timeAtOffset(-24),
    },
  ];

  const comments: TaskComment[] = [
    {
      id: "comment-one",
      taskId: "task-navigation",
      body: "The new snap behavior feels much better on a narrow screen.",
      createdAt: timeAtOffset(-7),
    },
    {
      id: "comment-two",
      taskId: "task-navigation",
      body: "I’ll tighten the column heading spacing before review.",
      createdAt: timeAtOffset(-3),
    },
    {
      id: "comment-three",
      taskId: "task-accessibility",
      body: "Keyboard flow is ready for one last pass.",
      createdAt: timeAtOffset(-2),
    },
  ];

  const activities: Activity[] = [
    {
      id: "activity-one",
      taskId: "task-navigation",
      action: "moved",
      metadata: { from: "todo", to: "in_progress" },
      createdAt: timeAtOffset(-30),
    },
    {
      id: "activity-two",
      taskId: "task-navigation",
      action: "updated",
      metadata: { fields: ["due date", "assignees"] },
      createdAt: timeAtOffset(-9),
    },
    {
      id: "activity-three",
      taskId: "task-accessibility",
      action: "moved",
      metadata: { from: "in_progress", to: "in_review" },
      createdAt: timeAtOffset(-4),
    },
  ];

  return { tasks, members, labels, comments, activities };
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function isOverdue(task: Task) {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${task.dueDate}T00:00:00`).getTime() < today.getTime();
}

export function dueState(task: Task): "overdue" | "soon" | "later" | "complete" | null {
  if (!task.dueDate) return null;
  if (task.status === "done") return "complete";
  if (isOverdue(task)) return "overdue";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = new Date(`${task.dueDate}T00:00:00`).getTime() - today.getTime();
  return diff <= 2 * 24 * 60 * 60 * 1000 ? "soon" : "later";
}

export function formatDueDate(date: string) {
  const value = new Date(`${date}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (value.toDateString() === today.toDateString()) return "Today";
  if (value.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(value);
}

export function formatRelativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

export function describeActivity(activity: Activity) {
  if (activity.action === "created" || activity.action === "task_created") return "Created this task";
  if (activity.action === "commented" || activity.action === "comment_added") return "Added a comment";
  if (activity.action === "moved" || activity.action === "status_changed") {
    const from = activity.metadata.from as TaskStatus | undefined;
    const to = activity.metadata.to as TaskStatus | undefined;
    if (from && to) return `Moved from ${STATUS_TITLE[from]} to ${STATUS_TITLE[to]}`;
    return "Moved this task";
  }
  if (activity.action === "updated" || activity.action === "task_updated") {
    const fields = activity.metadata.fields;
    if (Array.isArray(fields) && fields.length) return `Updated ${fields.join(", ")}`;
    return "Updated task details";
  }
  if (activity.action === "assignee_added") return "Added an assignee";
  if (activity.action === "assignee_removed") return "Removed an assignee";
  if (activity.action === "label_added") return "Added a label";
  if (activity.action === "label_removed") return "Removed a label";
  return "Updated this task";
}
