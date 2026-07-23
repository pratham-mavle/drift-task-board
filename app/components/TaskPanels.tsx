"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  BOARD_COLUMNS,
  describeActivity,
  formatRelativeTime,
  initials,
  LABEL_COLORS,
  MEMBER_COLORS,
  STATUS_TITLE,
  type Activity,
  type Label,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  type TeamMember,
} from "@/lib/board";
import { Avatar } from "./TaskCard";

const COLOR_NAMES: Record<string, string> = {
  "#5B5BD6": "indigo",
  "#D96C52": "coral",
  "#2D8C73": "teal",
  "#B6782A": "amber",
  "#8A5CB8": "violet",
  "#3575A8": "blue",
};

export type TaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assigneeIds: string[];
  labelIds: string[];
};

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: "",
  description: "",
  status: "todo",
  priority: "normal",
  dueDate: "",
  assigneeIds: [],
  labelIds: [],
};

export function taskToForm(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
    assigneeIds: task.assigneeIds,
    labelIds: task.labelIds,
  };
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function TaskEditorFields({
  values,
  onChange,
  members,
  labels,
  onCreateLabel,
}: {
  values: TaskFormValues;
  onChange: (values: TaskFormValues) => void;
  members: TeamMember[];
  labels: Label[];
  onCreateLabel?: () => void;
}) {
  return (
    <div className="task-editor-fields">
      <label className="field field--title">
        <span>Task title</span>
        <input
          autoFocus
          required
          maxLength={180}
          value={values.title}
          onChange={(event) => onChange({ ...values, title: event.target.value })}
          placeholder="Task title"
        />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          value={values.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
          placeholder="Add details, links, or notes…"
          rows={4}
        />
      </label>

      <div className="field-row">
        <label className="field field--compact">
          <span>Status</span>
          <span className="select-shell">
            <select
              value={values.status}
              onChange={(event) => onChange({ ...values, status: event.target.value as TaskStatus })}
            >
              {BOARD_COLUMNS.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </label>
        <label className="field field--compact">
          <span>Priority</span>
          <span className="select-shell">
            <select
              value={values.priority}
              onChange={(event) => onChange({ ...values, priority: event.target.value as TaskPriority })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </label>
        <label className="field field--compact">
          <span>Due date</span>
          <input
            type="date"
            value={values.dueDate}
            onChange={(event) => onChange({ ...values, dueDate: event.target.value })}
          />
        </label>
      </div>

      <fieldset className="choice-fieldset">
        <legend>Assignees</legend>
        <div className="choice-list">
          {members.length ? (
            members.map((member) => {
              const active = values.assigneeIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  className={`person-choice${active ? " is-active" : ""}`}
                  onClick={() => onChange({ ...values, assigneeIds: toggleValue(values.assigneeIds, member.id) })}
                  aria-pressed={active}
                >
                  <Avatar member={member} />
                  <span>{member.name}</span>
                  {active ? <Check size={14} /> : null}
                </button>
              );
            })
          ) : (
            <p className="choice-empty">Add a team member to assign this task.</p>
          )}
        </div>
      </fieldset>

      <fieldset className="choice-fieldset">
        <div className="fieldset-heading">
          <legend>Labels</legend>
          {onCreateLabel ? (
            <button type="button" className="text-button" onClick={onCreateLabel}>
              <Plus size={13} /> New label
            </button>
          ) : null}
        </div>
        <div className="choice-list choice-list--labels">
          {labels.map((label) => {
            const active = values.labelIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                className={`label-choice${active ? " is-active" : ""}`}
                style={{ "--label-color": label.color } as CSSProperties}
                onClick={() => onChange({ ...values, labelIds: toggleValue(values.labelIds, label.id) })}
                aria-pressed={active}
              >
                <span className="label-choice__dot" />
                {label.name}
                {active ? <Check size={13} /> : null}
              </button>
            );
          })}
          {!labels.length ? <p className="choice-empty">Create a label to group related tasks.</p> : null}
        </div>
      </fieldset>
    </div>
  );
}

function DialogShell({
  children,
  onClose,
  className = "",
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.classList.remove("has-dialog");
    };
  }, [onClose]);

  return (
    <div className={`dialog-backdrop ${className}`} role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog-surface"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

export function CreateTaskModal({
  initialStatus,
  members,
  labels,
  onClose,
  onCreate,
  onCreateLabel,
}: {
  initialStatus: TaskStatus;
  members: TeamMember[];
  labels: Label[];
  onClose: () => void;
  onCreate: (values: TaskFormValues) => Promise<void>;
  onCreateLabel: () => void;
}) {
  const [values, setValues] = useState<TaskFormValues>({ ...EMPTY_TASK_FORM, status: initialStatus });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.title.trim()) {
      setError("Enter a task title.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onCreate({ ...values, title: values.title.trim() });
      onClose();
    } catch {
      setError("Couldn’t create the task. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell onClose={onClose} className="dialog-backdrop--center" label="Create a new task">
      <form className="task-modal" onSubmit={submit}>
        <header className="dialog-header">
          <div>
            <h2>New task</h2>
            <p>Add a title and any details you need.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close create task dialog">
            <X size={18} />
          </button>
        </header>
        <TaskEditorFields
          values={values}
          onChange={setValues}
          members={members}
          labels={labels}
          onCreateLabel={onCreateLabel}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="dialog-footer">
          <span />
          <div>
            <button type="button" className="button button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? "Creating…" : "Create task"} <ArrowRight size={15} />
            </button>
          </div>
        </footer>
      </form>
    </DialogShell>
  );
}

export function TaskDrawer({
  task,
  members,
  labels,
  comments,
  activities,
  onClose,
  onSave,
  onDelete,
  onComment,
  onCreateLabel,
}: {
  task: Task;
  members: TeamMember[];
  labels: Label[];
  comments: TaskComment[];
  activities: Activity[];
  onClose: () => void;
  onSave: (task: Task, values: TaskFormValues) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onComment: (task: Task, body: string) => Promise<void>;
  onCreateLabel: () => void;
}) {
  const [values, setValues] = useState<TaskFormValues>(() => taskToForm(task));
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskComments = useMemo(
    () => [...comments].filter((item) => item.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [comments, task.id],
  );
  const taskActivities = useMemo(
    () => [...activities].filter((item) => item.taskId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activities, task.id],
  );

  const save = async () => {
    if (!values.title.trim()) {
      setError("Enter a task title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(task, { ...values, title: values.title.trim() });
    } catch {
      setError("Couldn’t save changes. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setCommenting(true);
    try {
      await onComment(task, comment.trim());
      setComment("");
    } catch {
      setError("Couldn’t post the comment. Check your connection and try again.");
    } finally {
      setCommenting(false);
    }
  };

  return (
    <DialogShell onClose={onClose} className="dialog-backdrop--drawer" label={`Task details for ${task.title}`}>
      <div className="task-drawer">
        <header className="drawer-header">
          <div className="drawer-breadcrumb">
            <span className={`status-dot status-dot--${task.status}`} />
            My board <span>/</span> {STATUS_TITLE[task.status]}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close task details">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-scroll" ref={scrollRef}>
          <TaskEditorFields
            values={values}
            onChange={setValues}
            members={members}
            labels={labels}
            onCreateLabel={onCreateLabel}
          />
          {error ? <p className="form-error">{error}</p> : null}

          <div className="drawer-actions">
            <button type="button" className="button button--primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {deleteConfirm ? (
              <div className="delete-confirm">
                <span>Delete this task?</span>
                <button
                  type="button"
                  className="text-button text-button--danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setError("");
                    try {
                      await onDelete(task);
                      onClose();
                    } catch {
                      setError("Couldn’t delete the task. Check your connection and try again.");
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "Deleting…" : "Delete task"}
                </button>
                <button type="button" className="text-button" onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="icon-text-button icon-text-button--danger" onClick={() => setDeleteConfirm(true)}>
                <Trash2 size={14} /> Delete task
              </button>
            )}
          </div>

          <section className="drawer-section">
            <div className="section-heading">
              <div>
                <span className="section-icon"><MessageCircle size={15} /></span>
                <h3>Comments</h3>
              </div>
              <span>{taskComments.length}</span>
            </div>
            <div className="comment-list">
              {taskComments.length ? (
                taskComments.map((item) => (
                  <article key={item.id} className="comment-item">
                    <span className="comment-avatar">G</span>
                    <div>
                      <header><strong>You</strong><time>{formatRelativeTime(item.createdAt)}</time></header>
                      <p>{item.body}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="quiet-empty">
                  <MessageCircle size={18} />
                  <p>No comments yet.</p>
                </div>
              )}
            </div>
            <form className="comment-composer" onSubmit={submitComment}>
              <span className="comment-avatar">{initials("Guest")}</span>
              <label>
                <span className="sr-only">Write a comment</span>
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Write a comment…"
                />
                <button type="submit" className="send-button" disabled={!comment.trim() || commenting} aria-label="Post comment">
                  <Send size={15} />
                </button>
              </label>
            </form>
          </section>

          <section className="drawer-section drawer-section--activity">
            <div className="section-heading">
              <div>
                <span className="section-icon"><Clock3 size={15} /></span>
                <h3>Activity</h3>
              </div>
            </div>
            <div className="activity-list">
              {taskActivities.length ? (
                taskActivities.map((item) => (
                  <div key={item.id} className="activity-item">
                    <span className="activity-item__dot" />
                    <p>{describeActivity(item)} <time>· {formatRelativeTime(item.createdAt)}</time></p>
                  </div>
                ))
              ) : (
                <div className="activity-item">
                  <span className="activity-item__dot" />
                  <p>Created this task <time>· {formatRelativeTime(task.createdAt)}</time></p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </DialogShell>
  );
}

export function NameColorModal({
  kind,
  onClose,
  onCreate,
}: {
  kind: "member" | "label";
  onClose: () => void;
  onCreate: (name: string, color: string) => Promise<void>;
}) {
  const palette = kind === "member" ? MEMBER_COLORS : LABEL_COLORS;
  const [name, setName] = useState("");
  const [color, setColor] = useState(palette[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onCreate(name.trim(), color);
      onClose();
    } catch {
      setError(`Couldn’t create the ${kind}. Check your connection and try again.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell onClose={onClose} className="dialog-backdrop--center dialog-backdrop--above" label={`Create ${kind}`}>
      <form className="mini-modal" onSubmit={submit}>
        <header className="dialog-header">
          <div>
            <h2>{kind === "member" ? "Add a team member" : "Create a label"}</h2>
            <p>{kind === "member" ? "Add someone you can assign tasks to." : "Group related tasks with a name and color."}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        <label className="field">
          <span>{kind === "member" ? "Name" : "Label name"}</span>
          <input autoFocus required value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={kind === "member" ? "e.g. Sam Rivera" : "e.g. Customer"} />
        </label>
        <fieldset className="color-fieldset">
          <legend>Color</legend>
          <div>
            {palette.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`color-swatch${color === swatch ? " is-active" : ""}`}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
                aria-label={`Select ${COLOR_NAMES[swatch] ?? "color"}`}
                aria-pressed={color === swatch}
              >
                {color === swatch ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </fieldset>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="dialog-footer">
          <span />
          <div>
            <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving || !name.trim()}>
              {saving ? (kind === "member" ? "Adding…" : "Creating…") : kind === "member" ? "Add member" : "Create label"}
            </button>
          </div>
        </footer>
      </form>
    </DialogShell>
  );
}
