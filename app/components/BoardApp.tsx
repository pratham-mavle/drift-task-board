"use client";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and reactive attributes through hook result objects. */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  CircleDashed,
  Filter,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Plus,
  RotateCcw,
  Search,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BOARD_COLUMNS,
  DEMO_STORAGE_KEY,
  STATUS_TITLE,
  createDemoWorkspace,
  createId,
  isOverdue,
  type Activity,
  type Label,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  type TeamMember,
  type WorkspaceSnapshot,
} from "@/lib/board";
import { getSupabaseClient } from "@/lib/supabase";
import { Avatar, AvatarStack, TaskCard } from "./TaskCard";
import {
  CreateTaskModal,
  NameColorModal,
  TaskDrawer,
  type TaskFormValues,
} from "./TaskPanels";

type StorageMode = "demo" | "supabase";
type SyncState = "connecting" | "synced" | "reconnecting" | "error";

const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  tasks: [],
  members: [],
  labels: [],
  comments: [],
  activities: [],
};

type DbRow = Record<string, unknown>;

function mapTask(row: DbRow, assignees: DbRow[], taskLabels: DbRow[]): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueDate: row.due_date ? String(row.due_date) : null,
    position: Number(row.position ?? 0),
    assigneeIds: assignees
      .filter((item) => item.task_id === row.id)
      .map((item) => String(item.team_member_id)),
    labelIds: taskLabels
      .filter((item) => item.task_id === row.id)
      .map((item) => String(item.label_id)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

async function fetchLiveWorkspace(client: SupabaseClient, userId: string): Promise<WorkspaceSnapshot> {
  const [tasksResult, membersResult, labelsResult, commentsResult, activitiesResult, assigneesResult, taskLabelsResult] =
    await Promise.all([
      client.from("tasks").select("*").eq("user_id", userId).order("position"),
      client.from("team_members").select("*").eq("user_id", userId).order("created_at"),
      client.from("labels").select("*").eq("user_id", userId).order("created_at"),
      client.from("comments").select("*").eq("user_id", userId).order("created_at"),
      client.from("activity_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      client.from("task_assignees").select("*").eq("user_id", userId),
      client.from("task_labels").select("*").eq("user_id", userId),
    ]);

  const results = [
    tasksResult,
    membersResult,
    labelsResult,
    commentsResult,
    activitiesResult,
    assigneesResult,
    taskLabelsResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const taskRows = (tasksResult.data ?? []) as DbRow[];
  const assigneeRows = (assigneesResult.data ?? []) as DbRow[];
  const taskLabelRows = (taskLabelsResult.data ?? []) as DbRow[];

  return {
    tasks: taskRows.map((row) => mapTask(row, assigneeRows, taskLabelRows)),
    members: ((membersResult.data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color ?? "#5B5BD6"),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      createdAt: String(row.created_at),
    })),
    labels: ((labelsResult.data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color ?? "#5B5BD6"),
      createdAt: String(row.created_at),
    })),
    comments: ((commentsResult.data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      body: String(row.body),
      createdAt: String(row.created_at),
    })),
    activities: ((activitiesResult.data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      action: String(row.action),
      metadata: {
        ...((row.metadata ?? {}) as Record<string, unknown>),
        ...(row.old_status ? { from: row.old_status } : {}),
        ...(row.new_status ? { to: row.new_status } : {}),
      },
      createdAt: String(row.created_at),
    })),
  };
}

function normalizeStoredWorkspace(value: unknown): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as WorkspaceSnapshot;
  if (!Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.labels)) return null;
  return {
    tasks: snapshot.tasks,
    members: snapshot.members,
    labels: snapshot.labels,
    comments: Array.isArray(snapshot.comments) ? snapshot.comments : [],
    activities: Array.isArray(snapshot.activities) ? snapshot.activities : [],
  };
}

function getChangedFields(task: Task, values: TaskFormValues) {
  const fields: string[] = [];
  if (task.title !== values.title) fields.push("title");
  if (task.description !== values.description) fields.push("description");
  if (task.status !== values.status) fields.push("status");
  if (task.priority !== values.priority) fields.push("priority");
  if ((task.dueDate ?? "") !== values.dueDate) fields.push("due date");
  if ([...task.assigneeIds].sort().join() !== [...values.assigneeIds].sort().join()) fields.push("assignees");
  if ([...task.labelIds].sort().join() !== [...values.labelIds].sort().join()) fields.push("labels");
  return fields;
}

function LoadingWorkspace() {
  return (
    <main className="loading-workspace" role="status" aria-live="polite">
      <div className="loading-mark" aria-hidden="true">D</div>
      <div>
        <span className="eyebrow">Drift</span>
        <h1>Loading your board</h1>
        <p>Signing you in and loading tasks…</p>
      </div>
      <div className="loading-board" aria-hidden="true">
        {[0, 1, 2, 3].map((column) => (
          <div key={column} className="loading-column">
            <span />
            <i />
            <i className="short" />
          </div>
        ))}
      </div>
    </main>
  );
}

function WorkspaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="error-workspace">
      <div className="error-card">
        <span className="error-card__icon"><WifiOff size={22} /></span>
        <span className="eyebrow">Board unavailable</span>
        <h1>We couldn’t load your board.</h1>
        <p>{message}</p>
        <button className="button button--primary" onClick={onRetry}>
          <RotateCcw size={15} /> Try again
        </button>
      </div>
    </main>
  );
}

function Sidebar({
  members,
  total,
  completed,
  overdue,
  mode,
  onAddMember,
}: {
  members: TeamMember[];
  total: number;
  completed: number;
  overdue: number;
  mode: StorageMode;
  onAddMember: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">D</span>
        <span>Drift</span>
      </div>

      <nav className="main-nav" aria-label="Workspace navigation">
        <span className="nav-label">Workspace</span>
        <button className="nav-item is-active"><LayoutDashboard size={17} /> My board <span>{total}</span></button>
      </nav>

      <section className="sidebar-team">
        <div className="sidebar-section-heading"><span>Team</span><button onClick={onAddMember} aria-label="Add team member"><Plus size={15} /></button></div>
        <div className="sidebar-member-list">
          {members.slice(0, 4).map((member) => (
            <div key={member.id} className="sidebar-member"><Avatar member={member} /><span>{member.name}</span></div>
          ))}
          {!members.length ? <p>No team members.</p> : null}
        </div>
        <button className="add-member-button" onClick={onAddMember}><Plus size={14} /> Add member</button>
      </section>

      <section className="sidebar-summary">
        <span className="nav-label">This board</span>
        <div className="sidebar-stats">
          <div><strong>{total}</strong><span>Total</span></div>
          <div><strong>{completed}</strong><span>Done</span></div>
          <div><strong className={overdue ? "is-alert" : ""}>{overdue}</strong><span>Overdue</span></div>
        </div>
        <div className="completion-track"><span style={{ width: total ? `${(completed / total) * 100}%` : "0%" }} /></div>
        <p>{total ? `${Math.round((completed / total) * 100)}% complete` : "No tasks yet"}</p>
      </section>

      <div className="sidebar-account">
        <span className="guest-avatar">G</span>
        <div><strong>Guest session</strong><span>{mode === "supabase" ? "Private workspace" : "Saved on this device"}</span></div>
      </div>
    </aside>
  );
}

function BoardColumn({
  status,
  tasks,
  allMembers,
  allLabels,
  comments,
  onOpenTask,
  onAddTask,
}: {
  status: TaskStatus;
  tasks: Task[];
  allMembers: TeamMember[];
  allLabels: Label[];
  comments: TaskComment[];
  onOpenTask: (id: string) => void;
  onAddTask: (status: TaskStatus) => void;
}) {
  const droppable = useDroppable({ id: `column-${status}` });
  const column = BOARD_COLUMNS.find((item) => item.id === status)!;
  return (
    <section
      ref={droppable.setNodeRef}
      className={`board-column board-column--${status}${droppable.isOver ? " is-over" : ""}`}
      aria-labelledby={`column-${status}-title`}
    >
      <header className="column-header">
        <div>
          <span className={`status-icon status-icon--${status}`}><span /></span>
          <div><h2 id={`column-${status}-title`}>{column.title}</h2></div>
        </div>
        <div className="column-header__actions">
          <span className="task-count">{tasks.length}</span>
          <button type="button" onClick={() => onAddTask(status)} aria-label={`Add task to ${column.title}`}><Plus size={16} /></button>
        </div>
      </header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="column-tasks">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              members={allMembers}
              labels={allLabels}
              commentCount={comments.filter((item) => item.taskId === task.id).length}
              onOpen={onOpenTask}
            />
          ))}
          {!tasks.length ? (
            <button type="button" className="column-empty" onClick={() => onAddTask(status)}>
              <strong>No tasks</strong>
              <small>Add a task or drop one here.</small>
            </button>
          ) : (
            <button type="button" className="column-add" onClick={() => onAddTask(status)}><Plus size={15} /> Add task</button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default function BoardApp() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const workspaceRef = useRef(workspace);
  const [mode, setMode] = useState<StorageMode>("demo");
  const modeRef = useRef<StorageMode>("demo");
  const userIdRef = useRef("local-demo");
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("connecting");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [miniModal, setMiniModal] = useState<"member" | "label" | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string; tone: "default" | "error" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<SupabaseClient | null>(null);

  const commitWorkspace = useCallback((next: WorkspaceSnapshot, persist = modeRef.current === "demo") => {
    workspaceRef.current = next;
    setWorkspace(next);
    if (persist && typeof window !== "undefined") {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  const notify = useCallback((message: string, tone: "default" | "error" = "default") => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 3400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const initialize = async () => {
      setLoading(true);
      setFatalError("");
      setSyncState("connecting");
      const forceDemo = new URLSearchParams(window.location.search).get("demo") === "1";
      const client = forceDemo ? null : getSupabaseClient();

      if (!client) {
        modeRef.current = "demo";
        setMode("demo");
        let snapshot: WorkspaceSnapshot | null = null;
        try {
          const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
          snapshot = stored ? normalizeStoredWorkspace(JSON.parse(stored)) : null;
        } catch {
          snapshot = null;
        }
        if (!snapshot) snapshot = createDemoWorkspace();
        if (!cancelled) {
          commitWorkspace(snapshot, true);
          userIdRef.current = "local-demo";
          setSyncState("synced");
          setLoading(false);
        }
        return;
      }

      clientRef.current = client;
      modeRef.current = "supabase";
      setMode("supabase");
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        let session = sessionData.session;
        if (!session) {
          const { data, error } = await client.auth.signInAnonymously();
          if (error) throw error;
          session = data.session;
        }
        if (!session?.user) throw new Error("Anonymous sign-in did not return a guest session.");
        await client.realtime.setAuth(session.access_token);
        const liveUserId = session.user.id;
        userIdRef.current = liveUserId;
        const snapshot = await fetchLiveWorkspace(client, liveUserId);
        if (cancelled) return;
        commitWorkspace(snapshot, false);
        setSyncState("synced");
        setLoading(false);

        const refresh = async () => {
          if (cancelled) return;
          try {
            const updated = await fetchLiveWorkspace(client, liveUserId);
            if (!cancelled) {
              commitWorkspace(updated, false);
              setSyncState("synced");
            }
          } catch {
            if (!cancelled) setSyncState("reconnecting");
          }
        };

        channel = client
          .channel(`drift-workspace-${liveUserId}`)
          .on("postgres_changes", { event: "*", schema: "public" }, () => {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(refresh, 240);
          })
          .subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") setSyncState("synced");
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncState("reconnecting");
          });
      } catch {
        if (!cancelled) {
          setFatalError("Check your connection and try again.");
          setSyncState("error");
          setLoading(false);
        }
      }
    };

    initialize();
    return () => {
      cancelled = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      if (channel && clientRef.current) clientRef.current.removeChannel(channel);
    };
  }, [commitWorkspace, reloadKey]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.matches("input, textarea, select, [contenteditable='true']");
      if ((event.key === "/" || (event.metaKey && event.key.toLowerCase() === "k")) && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "n" && !typing && !createStatus && !selectedTaskId) {
        event.preventDefault();
        setCreateStatus("todo");
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [createStatus, selectedTaskId]);

  const addActivity = useCallback(
    async (taskId: string, action: string, metadata: Record<string, unknown>) => {
      const createdAt = new Date().toISOString();
      if (modeRef.current === "demo") {
        const activity: Activity = { id: createId("activity"), taskId, action, metadata, createdAt };
        commitWorkspace({ ...workspaceRef.current, activities: [activity, ...workspaceRef.current.activities] }, true);
        return;
      }
      const client = clientRef.current;
      if (!client) throw new Error("Supabase is not connected.");
      // Supabase activity history is intentionally append-only. Database
      // triggers record authoritative task, assignment, label, and comment
      // events; the realtime subscription refreshes them into this view.
      void client;
      void taskId;
      void action;
      void metadata;
    },
    [commitWorkspace],
  );

  const createTask = useCallback(async (values: TaskFormValues) => {
    const current = workspaceRef.current;
    const position = Math.max(0, ...current.tasks.filter((task) => task.status === values.status).map((task) => task.position)) + 1000;
    const now = new Date().toISOString();
    if (modeRef.current === "demo") {
      const task: Task = {
        id: createId("task"), title: values.title, description: values.description, status: values.status,
        priority: values.priority, dueDate: values.dueDate || null, position,
        assigneeIds: values.assigneeIds, labelIds: values.labelIds, createdAt: now, updatedAt: now,
      };
      const activity: Activity = { id: createId("activity"), taskId: task.id, action: "created", metadata: {}, createdAt: now };
      commitWorkspace({ ...current, tasks: [...current.tasks, task], activities: [activity, ...current.activities] }, true);
      notify("Task created");
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Supabase is not connected.");
    const { data, error } = await client.from("tasks").insert({
      user_id: userIdRef.current, title: values.title, description: values.description, status: values.status,
      priority: values.priority, due_date: values.dueDate || null, position,
    }).select().single();
    if (error) throw error;
    const row = data as DbRow;
    const taskId = String(row.id);
    const joins = [];
    if (values.assigneeIds.length) joins.push(client.from("task_assignees").insert(values.assigneeIds.map((team_member_id) => ({ task_id: taskId, team_member_id, user_id: userIdRef.current }))));
    if (values.labelIds.length) joins.push(client.from("task_labels").insert(values.labelIds.map((label_id) => ({ task_id: taskId, label_id, user_id: userIdRef.current }))));
    const joinResults = await Promise.all(joins);
    const joinFailure = joinResults.find((result) => result.error);
    if (joinFailure?.error) {
      await client.from("tasks").delete().eq("id", taskId);
      throw joinFailure.error;
    }
    const task = mapTask(row, values.assigneeIds.map((team_member_id) => ({ task_id: taskId, team_member_id })), values.labelIds.map((label_id) => ({ task_id: taskId, label_id })));
    commitWorkspace({ ...workspaceRef.current, tasks: [...workspaceRef.current.tasks, task] }, false);
    await addActivity(task.id, "created", {});
    notify("Task created");
  }, [addActivity, commitWorkspace, notify]);

  const saveTask = useCallback(async (task: Task, values: TaskFormValues) => {
    const before = workspaceRef.current;
    const fields = getChangedFields(task, values);
    if (!fields.length) {
      notify("No changes to save");
      return;
    }
    const updated: Task = {
      ...task, title: values.title, description: values.description, status: values.status,
      priority: values.priority, dueDate: values.dueDate || null,
      assigneeIds: values.assigneeIds, labelIds: values.labelIds, updatedAt: new Date().toISOString(),
    };
    const optimistic = { ...before, tasks: before.tasks.map((item) => item.id === task.id ? updated : item) };
    commitWorkspace(optimistic, modeRef.current === "demo");
    setSelectedTaskId(updated.id);

    const action = task.status !== updated.status ? "moved" : "updated";
    const metadata = action === "moved" ? { from: task.status, to: updated.status } : { fields };
    if (modeRef.current === "demo") {
      const activity: Activity = { id: createId("activity"), taskId: task.id, action, metadata, createdAt: new Date().toISOString() };
      commitWorkspace({ ...workspaceRef.current, activities: [activity, ...workspaceRef.current.activities] }, true);
      notify("Changes saved");
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Supabase is not connected.");
    try {
      const { error } = await client.from("tasks").update({
        title: updated.title, description: updated.description, status: updated.status, priority: updated.priority,
        due_date: updated.dueDate, position: updated.position,
      }).eq("id", task.id);
      if (error) throw error;
      const removedAssignees = task.assigneeIds.filter((id) => !updated.assigneeIds.includes(id));
      const addedAssignees = updated.assigneeIds.filter((id) => !task.assigneeIds.includes(id));
      const removedLabels = task.labelIds.filter((id) => !updated.labelIds.includes(id));
      const addedLabels = updated.labelIds.filter((id) => !task.labelIds.includes(id));
      const relationshipChanges = [];
      if (removedAssignees.length) relationshipChanges.push(client.from("task_assignees").delete().eq("task_id", task.id).in("team_member_id", removedAssignees));
      if (removedLabels.length) relationshipChanges.push(client.from("task_labels").delete().eq("task_id", task.id).in("label_id", removedLabels));
      const deletionResults = await Promise.all(relationshipChanges);
      const deletionFailure = deletionResults.find((result) => result.error);
      if (deletionFailure?.error) throw deletionFailure.error;
      const inserts = [];
      if (addedAssignees.length) inserts.push(client.from("task_assignees").insert(addedAssignees.map((team_member_id) => ({ task_id: task.id, team_member_id, user_id: userIdRef.current }))));
      if (addedLabels.length) inserts.push(client.from("task_labels").insert(addedLabels.map((label_id) => ({ task_id: task.id, label_id, user_id: userIdRef.current }))));
      const insertResults = await Promise.all(inserts);
      const failed = insertResults.find((result) => result.error);
      if (failed?.error) throw failed.error;
      await addActivity(task.id, action, metadata);
      notify("Changes saved");
    } catch (caught) {
      commitWorkspace(before, false);
      throw caught;
    }
  }, [addActivity, commitWorkspace, notify]);

  const deleteTask = useCallback(async (task: Task) => {
    const before = workspaceRef.current;
    const next: WorkspaceSnapshot = {
      ...before,
      tasks: before.tasks.filter((item) => item.id !== task.id),
      comments: before.comments.filter((item) => item.taskId !== task.id),
      activities: before.activities.filter((item) => item.taskId !== task.id),
    };
    commitWorkspace(next, modeRef.current === "demo");
    if (modeRef.current === "supabase") {
      const client = clientRef.current;
      if (!client) throw new Error("Supabase is not connected.");
      const { error } = await client.from("tasks").delete().eq("id", task.id);
      if (error) {
        commitWorkspace(before, false);
        throw error;
      }
    }
    notify("Task deleted");
  }, [commitWorkspace, notify]);

  const addComment = useCallback(async (task: Task, body: string) => {
    const now = new Date().toISOString();
    if (modeRef.current === "demo") {
      const comment: TaskComment = { id: createId("comment"), taskId: task.id, body, createdAt: now };
      const activity: Activity = { id: createId("activity"), taskId: task.id, action: "commented", metadata: {}, createdAt: now };
      commitWorkspace({ ...workspaceRef.current, comments: [...workspaceRef.current.comments, comment], activities: [activity, ...workspaceRef.current.activities] }, true);
      notify("Comment added");
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Supabase is not connected.");
    const { data, error } = await client.from("comments").insert({ user_id: userIdRef.current, task_id: task.id, body }).select().single();
    if (error) throw error;
    const row = data as DbRow;
    const comment: TaskComment = { id: String(row.id), taskId: String(row.task_id), body: String(row.body), createdAt: String(row.created_at) };
    commitWorkspace({ ...workspaceRef.current, comments: [...workspaceRef.current.comments, comment] }, false);
    await addActivity(task.id, "commented", {});
    notify("Comment added");
  }, [addActivity, commitWorkspace, notify]);

  const createMember = useCallback(async (name: string, color: string) => {
    if (modeRef.current === "demo") {
      const member: TeamMember = { id: createId("member"), name, color, createdAt: new Date().toISOString() };
      commitWorkspace({ ...workspaceRef.current, members: [...workspaceRef.current.members, member] }, true);
      notify(`${name} added to the team`);
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Supabase is not connected.");
    const { data, error } = await client.from("team_members").insert({ user_id: userIdRef.current, name, color }).select().single();
    if (error) throw error;
    const row = data as DbRow;
    const member: TeamMember = { id: String(row.id), name: String(row.name), color: String(row.color), avatarUrl: row.avatar_url ? String(row.avatar_url) : null, createdAt: String(row.created_at) };
    commitWorkspace({ ...workspaceRef.current, members: [...workspaceRef.current.members, member] }, false);
    notify(`${name} added to the team`);
  }, [commitWorkspace, notify]);

  const createLabel = useCallback(async (name: string, color: string) => {
    if (modeRef.current === "demo") {
      const label: Label = { id: createId("label"), name, color, createdAt: new Date().toISOString() };
      commitWorkspace({ ...workspaceRef.current, labels: [...workspaceRef.current.labels, label] }, true);
      notify(`${name} label created`);
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Supabase is not connected.");
    const { data, error } = await client.from("labels").insert({ user_id: userIdRef.current, name, color }).select().single();
    if (error) throw error;
    const row = data as DbRow;
    const label: Label = { id: String(row.id), name: String(row.name), color: String(row.color), createdAt: String(row.created_at) };
    commitWorkspace({ ...workspaceRef.current, labels: [...workspaceRef.current.labels, label] }, false);
    notify(`${name} label created`);
  }, [commitWorkspace, notify]);

  const persistReorder = useCallback(async (nextTasks: Task[], moved: Task, previousStatus: TaskStatus) => {
    const before = workspaceRef.current;
    commitWorkspace({ ...before, tasks: nextTasks }, modeRef.current === "demo");
    if (modeRef.current === "demo") {
      if (moved.status !== previousStatus) {
        const activity: Activity = { id: createId("activity"), taskId: moved.id, action: "moved", metadata: { from: previousStatus, to: moved.status }, createdAt: new Date().toISOString() };
        commitWorkspace({ ...workspaceRef.current, activities: [activity, ...workspaceRef.current.activities] }, true);
        notify(`Moved to ${STATUS_TITLE[moved.status]}`);
      }
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    try {
      const changed = nextTasks.filter((task) => {
        const old = before.tasks.find((item) => item.id === task.id);
        return !old || old.status !== task.status || old.position !== task.position;
      });
      const results = await Promise.all(changed.map((task) => client.from("tasks").update({ status: task.status, position: task.position }).eq("id", task.id)));
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      if (moved.status !== previousStatus) {
        await addActivity(moved.id, "moved", { from: previousStatus, to: moved.status });
        notify(`Moved to ${STATUS_TITLE[moved.status]}`);
      }
    } catch {
      commitWorkspace(before, false);
      notify("Move failed. Your task is back where it was.", "error");
    }
  }, [addActivity, commitWorkspace, notify]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => setActiveTaskId(String(active.id));
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTaskId(null);
    if (!over || active.id === over.id) return;
    const allTasks = workspaceRef.current.tasks;
    const activeTask = allTasks.find((task) => task.id === active.id);
    if (!activeTask) return;
    const overId = String(over.id);
    const overTask = allTasks.find((task) => task.id === overId);
    const targetStatus = overId.startsWith("column-") ? overId.replace("column-", "") as TaskStatus : overTask?.status;
    if (!targetStatus) return;
    const previousStatus = activeTask.status;
    const replacements = new Map<string, Task>();

    if (targetStatus === previousStatus) {
      const column = allTasks.filter((task) => task.status === previousStatus).sort((a, b) => a.position - b.position);
      const oldIndex = column.findIndex((task) => task.id === activeTask.id);
      const newIndex = overTask ? column.findIndex((task) => task.id === overTask.id) : column.length - 1;
      if (oldIndex < 0 || newIndex < 0) return;
      arrayMove(column, oldIndex, newIndex).forEach((task, index) => replacements.set(task.id, { ...task, position: (index + 1) * 1000 }));
    } else {
      const source = allTasks.filter((task) => task.status === previousStatus && task.id !== activeTask.id).sort((a, b) => a.position - b.position);
      const target = allTasks.filter((task) => task.status === targetStatus && task.id !== activeTask.id).sort((a, b) => a.position - b.position);
      const insertAt = overTask ? Math.max(0, target.findIndex((task) => task.id === overTask.id)) : target.length;
      target.splice(insertAt, 0, { ...activeTask, status: targetStatus });
      source.forEach((task, index) => replacements.set(task.id, { ...task, position: (index + 1) * 1000 }));
      target.forEach((task, index) => replacements.set(task.id, { ...task, status: targetStatus, position: (index + 1) * 1000 }));
    }

    const nextTasks = allTasks.map((task) => replacements.get(task.id) ?? task);
    const moved = nextTasks.find((task) => task.id === activeTask.id)!;
    persistReorder(nextTasks, moved, previousStatus);
  };

  const clearFilters = () => {
    setQuery("");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setLabelFilter("all");
  };

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workspace.tasks.filter((task) => {
      if (normalized && !`${task.title} ${task.description}`.toLowerCase().includes(normalized)) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && !task.assigneeIds.includes(assigneeFilter)) return false;
      if (labelFilter !== "all" && !task.labelIds.includes(labelFilter)) return false;
      return true;
    });
  }, [assigneeFilter, labelFilter, priorityFilter, query, workspace.tasks]);

  const filterCount = [priorityFilter !== "all", assigneeFilter !== "all", labelFilter !== "all"].filter(Boolean).length;
  const total = workspace.tasks.length;
  const completed = workspace.tasks.filter((task) => task.status === "done").length;
  const overdue = workspace.tasks.filter(isOverdue).length;
  const taskSummary = total
    ? `${total} ${total === 1 ? "task" : "tasks"} · ${completed} completed${overdue ? ` · ${overdue} overdue` : ""}`
    : "No tasks yet";
  const selectedTask = workspace.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask = workspace.tasks.find((task) => task.id === activeTaskId) ?? null;

  if (loading) return <LoadingWorkspace />;
  if (fatalError) return <WorkspaceError message={fatalError} onRetry={() => setReloadKey((key) => key + 1)} />;

  return (
    <div className="app-shell">
      <Sidebar
        members={workspace.members}
        total={total}
        completed={completed}
        overdue={overdue}
        mode={mode}
        onAddMember={() => setMiniModal("member")}
      />

      <main className="workspace">
        {mode === "demo" ? (
          <div className="demo-banner"><span><strong>Demo mode</strong> — changes stay in this browser.</span></div>
        ) : null}
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={18} /> : <Menu size={18} />}</button>
          <div className="mobile-brand"><span className="brand-mark" aria-hidden="true">D</span> Drift</div>
          <div className="topbar-search">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
            />
            {query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button> : <kbd>⌘ K</kbd>}
          </div>
          <div className="topbar-actions">
            <div className={`sync-status sync-status--${syncState}`} title="Save status">
              {syncState === "synced" ? <Wifi size={14} /> : syncState === "connecting" ? <LoaderCircle size={14} className="spin" /> : <WifiOff size={14} />}
              <span>{mode === "demo" ? "Saved locally" : syncState === "synced" ? "Saved" : syncState === "connecting" ? "Connecting…" : syncState === "error" ? "Sync paused" : "Reconnecting…"}</span>
            </div>
          </div>
          {mobileNavOpen ? (
            <div className="mobile-nav-panel">
              <div className="mobile-nav-panel__heading"><strong>Workspace</strong><span>{total} tasks · {completed} done</span></div>
              <button className="is-active" onClick={() => setMobileNavOpen(false)}><LayoutDashboard size={16} /> My board</button>
              <button onClick={() => { setMiniModal("member"); setMobileNavOpen(false); }}><Users size={16} /> Add member</button>
              <div className="mobile-nav-panel__team"><span>Team</span><AvatarStack members={workspace.members} limit={4} /></div>
            </div>
          ) : null}
        </header>

        <div className="workspace-content">
          <section className="board-heading">
            <div>
              <h1>My board</h1>
              <p>{taskSummary}</p>
            </div>
            <div className="board-heading__actions">
              <button className={`button button--filter${filterCount ? " is-active" : ""}`} onClick={() => setFiltersOpen((open) => !open)}>
                <Filter size={15} /> Filter {filterCount ? <span>{filterCount}</span> : null}
              </button>
              <button className="button button--primary" onClick={() => setCreateStatus("todo")}><Plus size={16} /> New task</button>
            </div>
          </section>

          <section className={`filter-bar${filtersOpen || filterCount ? " is-open" : ""}`} aria-label="Board filters">
            <div className="filter-summary">
              <Filter size={14} /><span>{filteredTasks.length === total ? `${total} tasks` : `${filteredTasks.length} of ${total} shown`}</span>
            </div>
            <label><span className="sr-only">Priority</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TaskPriority | "all")}><option value="all">All priorities</option><option value="high">High priority</option><option value="normal">Normal priority</option><option value="low">Low priority</option></select><ChevronDown size={13} /></label>
            <label><span className="sr-only">Assignee</span><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">All assignees</option>{workspace.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><ChevronDown size={13} /></label>
            <label><span className="sr-only">Label</span><select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}><option value="all">All labels</option>{workspace.labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select><ChevronDown size={13} /></label>
            {filterCount || query ? <button className="text-button" onClick={clearFilters}><X size={13} /> Clear all</button> : null}
          </section>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveTaskId(null)}
            onDragEnd={handleDragEnd}
          >
            <section className="board" aria-label="Kanban task board">
              {BOARD_COLUMNS.map((column) => (
                <BoardColumn
                  key={column.id}
                  status={column.id}
                  tasks={filteredTasks.filter((task) => task.status === column.id).sort((a, b) => a.position - b.position)}
                  allMembers={workspace.members}
                  allLabels={workspace.labels}
                  comments={workspace.comments}
                  onOpenTask={setSelectedTaskId}
                  onAddTask={setCreateStatus}
                />
              ))}
              {!filteredTasks.length && total ? (
                <div className="no-results">
                  <CircleDashed size={22} />
                  <strong>No tasks match these filters</strong>
                  <button className="text-button" onClick={clearFilters}>Clear filters</button>
                </div>
              ) : null}
            </section>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
              {activeTask ? (
                <article className="task-card task-card--overlay">
                  <span className={`priority-mark priority-mark--${activeTask.priority}`} />
                  <h3>{activeTask.title}</h3>
                  <p>{STATUS_TITLE[activeTask.status]}</p>
                </article>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </main>

      {createStatus ? (
        <CreateTaskModal
          initialStatus={createStatus}
          members={workspace.members}
          labels={workspace.labels}
          onClose={() => setCreateStatus(null)}
          onCreate={createTask}
          onCreateLabel={() => setMiniModal("label")}
        />
      ) : null}
      {selectedTask ? (
        <TaskDrawer
          key={selectedTask.id}
          task={selectedTask}
          members={workspace.members}
          labels={workspace.labels}
          comments={workspace.comments}
          activities={workspace.activities}
          onClose={() => setSelectedTaskId(null)}
          onSave={saveTask}
          onDelete={deleteTask}
          onComment={addComment}
          onCreateLabel={() => setMiniModal("label")}
        />
      ) : null}
      {miniModal ? (
        <NameColorModal
          kind={miniModal}
          onClose={() => setMiniModal(null)}
          onCreate={miniModal === "member" ? createMember : createLabel}
        />
      ) : null}

      {toast ? (
        <div className={`toast${toast.tone === "error" ? " toast--error" : ""}`} role="status">
          {toast.tone === "error" ? <WifiOff size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ) : null}
    </div>
  );
}
