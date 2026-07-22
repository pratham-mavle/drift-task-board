"use client";
/* eslint-disable react-hooks/refs, @next/next/no-img-element -- dnd-kit provides callback refs; optional member avatars may be external URLs. */

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  GripVertical,
  MessageCircle,
} from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import {
  dueState,
  formatDueDate,
  initials,
  type Label,
  type Task,
  type TeamMember,
} from "@/lib/board";

export function Avatar({ member, size = "small" }: { member: TeamMember; size?: "small" | "medium" }) {
  return (
    <span
      className={`member-avatar member-avatar--${size}`}
      style={{ "--avatar-color": member.color } as CSSProperties}
      title={member.name}
      aria-label={member.name}
    >
      {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.name)}
    </span>
  );
}

export function AvatarStack({ members, limit = 3 }: { members: TeamMember[]; limit?: number }) {
  if (!members.length) return <span className="avatar-empty" aria-label="Unassigned" />;
  return (
    <span className="avatar-stack" aria-label={`Assigned to ${members.map((member) => member.name).join(", ")}`}>
      {members.slice(0, limit).map((member) => (
        <Avatar key={member.id} member={member} />
      ))}
      {members.length > limit ? <span className="avatar-more">+{members.length - limit}</span> : null}
    </span>
  );
}

function DueBadge({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  const state = dueState(task);
  const Icon = state === "overdue" ? CircleAlert : state === "complete" ? CheckCircle2 : CalendarDays;
  return (
    <span className={`due-badge due-badge--${state}`}>
      <Icon size={13} strokeWidth={2} />
      {formatDueDate(task.dueDate)}
    </span>
  );
}

type TaskCardProps = {
  task: Task;
  members: TeamMember[];
  labels: Label[];
  commentCount: number;
  onOpen: (taskId: string) => void;
  overlay?: boolean;
};

export function TaskCard({ task, members, labels, commentCount, onOpen, overlay = false }: TaskCardProps) {
  const sortable = useSortable({ id: task.id, disabled: overlay });
  const taskMembers = task.assigneeIds
    .map((id) => members.find((member) => member.id === id))
    .filter(Boolean) as TeamMember[];
  const taskLabels = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter(Boolean) as Label[];

  const style: CSSProperties | undefined = overlay
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.28 : 1,
      };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("[data-drag-handle]")) return;
    onOpen(task.id);
  };

  return (
    <article
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      className={`task-card${overlay ? " task-card--overlay" : ""}`}
      onClick={handleClick}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(task.id);
      }}
      aria-label={`${task.title}, ${task.priority} priority`}
    >
      <div className="task-card__topline">
        <div className="task-card__labels">
          {taskLabels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="label-chip"
              style={{ "--label-color": label.color } as CSSProperties}
            >
              {label.name}
            </span>
          ))}
          {taskLabels.length > 2 ? <span className="label-chip label-chip--more">+{taskLabels.length - 2}</span> : null}
        </div>
        <button
          type="button"
          className="drag-handle"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          data-drag-handle
          aria-label={`Drag ${task.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>
      </div>

      <h3>{task.title}</h3>
      {task.description ? <p className="task-card__description">{task.description}</p> : null}

      <div className="task-card__meta">
        <div className="task-card__signals">
          <span className={`priority-mark priority-mark--${task.priority}`} title={`${task.priority} priority`} />
          <DueBadge task={task} />
          {commentCount ? (
            <span className="comment-count" aria-label={`${commentCount} comments`}>
              <MessageCircle size={13} /> {commentCount}
            </span>
          ) : null}
        </div>
        <AvatarStack members={taskMembers} />
      </div>
    </article>
  );
}
