import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

assert.ok(url, "NEXT_PUBLIC_SUPABASE_URL is required");
assert.ok(publishableKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");

function createIsolatedClient() {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function signInGuest(client) {
  const { data, error } = await client.auth.signInAnonymously();
  assert.ifError(error);
  assert.ok(data.user?.id, "Anonymous sign-in did not return a user");
  assert.ok(data.session?.access_token, "Anonymous sign-in did not return a session token");
  await client.realtime.setAuth(data.session.access_token);
  return data.user;
}

function expectNoError(error, context) {
  assert.ifError(error && new Error(`${context}: ${error.message}`));
}

const clientA = createIsolatedClient();
const clientB = createIsolatedClient();
const marker = `drift-integration-${Date.now()}`;

let taskA;
let taskB;
let memberA;
let memberB;
let labelA;
let realtimeChannel;
let realtimeTimeout;

try {
  const [userA, userB] = await Promise.all([
    signInGuest(clientA),
    signInGuest(clientB),
  ]);
  assert.notEqual(userA.id, userB.id, "Guests must receive separate identities");

  const [{ data: createdA, error: taskErrorA }, { data: createdB, error: taskErrorB }] =
    await Promise.all([
      clientA
        .rpc("create_task_with_relationships", {
          p_title: `${marker}-A`,
          p_description: "Created atomically",
          p_status: "todo",
          p_priority: "high",
          p_due_date: null,
          p_position: 1000,
          p_assignee_ids: [],
          p_label_ids: [],
        })
        .single(),
      clientB
        .from("tasks")
        .insert({ title: `${marker}-B`, status: "todo", priority: "normal" })
        .select("id,user_id,title,status")
        .single(),
    ]);
  expectNoError(taskErrorA, "Create User A task");
  expectNoError(taskErrorB, "Create User B task");
  taskA = createdA;
  taskB = createdB;
  assert.equal(taskA.user_id, userA.id);
  assert.equal(taskB.user_id, userB.id);

  const [{ data: visibleA, error: visibleErrorA }, { data: visibleB, error: visibleErrorB }] =
    await Promise.all([
      clientA.from("tasks").select("title").like("title", `${marker}%`),
      clientB.from("tasks").select("title").like("title", `${marker}%`),
    ]);
  expectNoError(visibleErrorA, "Read User A tasks");
  expectNoError(visibleErrorB, "Read User B tasks");
  assert.deepEqual(visibleA.map(({ title }) => title), [`${marker}-A`]);
  assert.deepEqual(visibleB.map(({ title }) => title), [`${marker}-B`]);

  const [{ data: createdMemberA, error: memberErrorA }, { data: createdMemberB, error: memberErrorB }] =
    await Promise.all([
      clientA
        .from("team_members")
        .insert({ name: "Integration A", color: "#5965DB" })
        .select("id")
        .single(),
      clientB
        .from("team_members")
        .insert({ name: "Integration B", color: "#2E9F75" })
        .select("id")
        .single(),
    ]);
  expectNoError(memberErrorA, "Create User A member");
  expectNoError(memberErrorB, "Create User B member");
  memberA = createdMemberA;
  memberB = createdMemberB;

  const { data: createdLabelA, error: labelErrorA } = await clientA
    .from("labels")
    .insert({ name: `Integration ${marker.slice(-6)}`, color: "#E9A23B" })
    .select("id")
    .single();
  expectNoError(labelErrorA, "Create User A label");
  labelA = createdLabelA;

  const rejectedCreateTitle = `${marker}-cross-owner-create`;
  const { error: rejectedCreateError } = await clientA.rpc("create_task_with_relationships", {
    p_title: rejectedCreateTitle,
    p_description: "This task must never be committed",
    p_status: "todo",
    p_priority: "normal",
    p_due_date: null,
    p_position: 2000,
    p_assignee_ids: [memberB.id],
    p_label_ids: [labelA.id],
  });
  assert.ok(rejectedCreateError, "A cross-owner atomic create must be rejected");
  const { count: rejectedCreateCount, error: rejectedCreateCountError } = await clientA
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("title", rejectedCreateTitle);
  expectNoError(rejectedCreateCountError, "Verify rejected create left no task residue");
  assert.equal(rejectedCreateCount, 0);

  const { data: atomicUpdate, error: atomicUpdateError } = await clientA
    .rpc("update_task_with_relationships", {
      p_task_id: taskA.id,
      p_title: `${marker}-A`,
      p_description: "Updated atomically with relationships",
      p_status: "todo",
      p_priority: "high",
      p_due_date: null,
      p_position: 1000,
      p_assignee_ids: [memberA.id],
      p_label_ids: [labelA.id],
    })
    .single();
  expectNoError(atomicUpdateError, "Atomically update User A task and relationships");
  assert.equal(atomicUpdate.id, taskA.id);
  assert.equal(atomicUpdate.description, "Updated atomically with relationships");

  const { error: commentError } = await clientA.from("comments").insert({
    task_id: taskA.id,
    body: "Integration verification comment",
  });
  expectNoError(commentError, "Comment on User A task");

  const { error: crossOwnerError } = await clientA.from("task_assignees").insert({
    task_id: taskA.id,
    team_member_id: memberB.id,
  });
  assert.ok(crossOwnerError, "A cross-owner assignment must be rejected");

  const { error: crossOwnerRpcError } = await clientA.rpc("update_task_with_relationships", {
    p_task_id: taskA.id,
    p_title: "This must roll back",
    p_description: "Cross-owner relationship attempt",
    p_status: "done",
    p_priority: "low",
    p_due_date: null,
    p_position: 2000,
    p_assignee_ids: [memberB.id],
    p_label_ids: [labelA.id],
  });
  assert.ok(crossOwnerRpcError, "A cross-owner atomic update must be rejected");

  const [
    { data: taskAfterRollback, error: rollbackTaskError },
    { data: assignmentsAfterRollback, error: rollbackAssignmentError },
    { data: labelsAfterRollback, error: rollbackLabelError },
  ] =
    await Promise.all([
      clientA.from("tasks").select("title,status,position").eq("id", taskA.id).single(),
      clientA.from("task_assignees").select("team_member_id").eq("task_id", taskA.id),
      clientA.from("task_labels").select("label_id").eq("task_id", taskA.id),
    ]);
  expectNoError(rollbackTaskError, "Read task after rejected atomic update");
  expectNoError(rollbackAssignmentError, "Read assignments after rejected atomic update");
  expectNoError(rollbackLabelError, "Read labels after rejected atomic update");
  assert.equal(taskAfterRollback.title, `${marker}-A`);
  assert.equal(taskAfterRollback.status, "todo");
  assert.equal(Number(taskAfterRollback.position), 1000);
  assert.deepEqual(assignmentsAfterRollback.map(({ team_member_id }) => team_member_id), [memberA.id]);
  assert.deepEqual(labelsAfterRollback.map(({ label_id }) => label_id), [labelA.id]);

  const { error: mixedReorderError } = await clientA.rpc("reorder_tasks", {
    p_updates: [
      { id: taskA.id, status: "in_review", position: 2000 },
      { id: taskB.id, status: "done", position: 3000 },
    ],
  });
  assert.ok(mixedReorderError, "A mixed-owner reorder batch must be rejected");

  const { data: taskAfterReorderRollback, error: reorderRollbackReadError } = await clientA
    .from("tasks")
    .select("status,position")
    .eq("id", taskA.id)
    .single();
  expectNoError(reorderRollbackReadError, "Read task after rejected reorder batch");
  assert.equal(taskAfterReorderRollback.status, "todo");
  assert.equal(Number(taskAfterReorderRollback.position), 1000);

  const { error: clearRelationshipsError } = await clientA.rpc("update_task_with_relationships", {
    p_task_id: taskA.id,
    p_title: `${marker}-A`,
    p_description: "Updated atomically with relationships",
    p_status: "todo",
    p_priority: "high",
    p_due_date: null,
    p_position: 1000,
    p_assignee_ids: [],
    p_label_ids: [],
  });
  expectNoError(clearRelationshipsError, "Clear task relationships atomically");

  const [{ count: assignmentCount, error: assignmentCountError }, { count: labelCount, error: labelCountError }] =
    await Promise.all([
      clientA.from("task_assignees").select("*", { count: "exact", head: true }).eq("task_id", taskA.id),
      clientA.from("task_labels").select("*", { count: "exact", head: true }).eq("task_id", taskA.id),
    ]);
  expectNoError(assignmentCountError, "Count cleared assignments");
  expectNoError(labelCountError, "Count cleared labels");
  assert.equal(assignmentCount, 0);
  assert.equal(labelCount, 0);

  const { error: restoreRelationshipsError } = await clientA.rpc("update_task_with_relationships", {
    p_task_id: taskA.id,
    p_title: `${marker}-A`,
    p_description: "Updated atomically with relationships",
    p_status: "todo",
    p_priority: "high",
    p_due_date: null,
    p_position: 1000,
    p_assignee_ids: [memberA.id],
    p_label_ids: [labelA.id],
  });
  expectNoError(restoreRelationshipsError, "Restore task relationships atomically");

  let resolveRealtimeUpdate;
  let rejectRealtimeUpdate;
  const realtimeUpdate = new Promise((resolve, reject) => {
    resolveRealtimeUpdate = resolve;
    rejectRealtimeUpdate = reject;
  });
  realtimeTimeout = setTimeout(
    () => rejectRealtimeUpdate(new Error("Timed out waiting for the task realtime update")),
    20_000,
  );

  const subscribed = new Promise((resolve, reject) => {
    realtimeChannel = clientA
      .channel(`integration-${marker}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `id=eq.${taskA.id}`,
        },
        (payload) => resolveRealtimeUpdate(payload),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(`Realtime subscription failed: ${status}`));
        }
      });
  });
  await subscribed;

  const { data: reorderResult, error: moveError } = await clientA.rpc("reorder_tasks", {
    p_updates: [{ id: taskA.id, status: "in_progress", position: 1000 }],
  });
  expectNoError(moveError, "Move User A task");
  assert.equal(reorderResult.length, 1);
  assert.equal(reorderResult[0].status, "in_progress");

  const realtimePayload = await realtimeUpdate;
  clearTimeout(realtimeTimeout);
  assert.equal(realtimePayload.new.id, taskA.id);
  assert.equal(realtimePayload.new.status, "in_progress");

  const { data: activity, error: activityError } = await clientA
    .from("activity_logs")
    .select("action")
    .eq("task_id", taskA.id)
    .order("created_at", { ascending: true });
  expectNoError(activityError, "Read User A activity");
  const actions = new Set(activity.map(({ action }) => action));
  for (const expected of [
    "task_created",
    "status_changed",
    "assignee_added",
    "label_added",
    "comment_added",
  ]) {
    assert.ok(actions.has(expected), `Missing activity action: ${expected}`);
  }

  console.log(
    "Supabase integration passed: anonymous auth, RLS isolation, realtime, atomic task writes, relationships, and activity.",
  );
} finally {
  if (realtimeTimeout) clearTimeout(realtimeTimeout);
  if (realtimeChannel) await clientA.removeChannel(realtimeChannel);
  if (taskA?.id) await clientA.from("tasks").delete().eq("id", taskA.id);
  if (taskB?.id) await clientB.from("tasks").delete().eq("id", taskB.id);
  if (labelA?.id) await clientA.from("labels").delete().eq("id", labelA.id);
  if (memberA?.id) await clientA.from("team_members").delete().eq("id", memberA.id);
  if (memberB?.id) await clientB.from("team_members").delete().eq("id", memberB.id);
  await Promise.allSettled([clientA.auth.signOut(), clientB.auth.signOut()]);
  clientA.realtime.disconnect();
  clientB.realtime.disconnect();
}
