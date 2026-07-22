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
        .from("tasks")
        .insert({ title: `${marker}-A`, status: "todo", priority: "high" })
        .select("id,user_id,title,status")
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

  for (const [context, operation] of [
    [
      "Assign User A member",
      clientA.from("task_assignees").insert({
        task_id: taskA.id,
        team_member_id: memberA.id,
      }),
    ],
    [
      "Label User A task",
      clientA.from("task_labels").insert({
        task_id: taskA.id,
        label_id: labelA.id,
      }),
    ],
    [
      "Comment on User A task",
      clientA.from("comments").insert({
        task_id: taskA.id,
        body: "Integration verification comment",
      }),
    ],
  ]) {
    const { error } = await operation;
    expectNoError(error, context);
  }

  const { error: crossOwnerError } = await clientA.from("task_assignees").insert({
    task_id: taskA.id,
    team_member_id: memberB.id,
  });
  assert.ok(crossOwnerError, "A cross-owner assignment must be rejected");

  let resolveRealtimeUpdate;
  let rejectRealtimeUpdate;
  const realtimeUpdate = new Promise((resolve, reject) => {
    resolveRealtimeUpdate = resolve;
    rejectRealtimeUpdate = reject;
  });
  realtimeTimeout = setTimeout(
    () => rejectRealtimeUpdate(new Error("Timed out waiting for the task realtime update")),
    10_000,
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

  const { error: moveError } = await clientA
    .from("tasks")
    .update({ status: "in_progress" })
    .eq("id", taskA.id);
  expectNoError(moveError, "Move User A task");

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
    "Supabase integration passed: anonymous auth, RLS isolation, realtime, relationships, and activity.",
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
}
