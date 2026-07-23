import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the branded application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Drift — Task board<\/title>/i);
  assert.match(html, /Loading your board/);
  assert.match(html, />Drift</);
  assert.match(html, /Signing you in and loading tasks/);
  assert.match(html, /http:\/\/localhost\/og-v2\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  assert.match(html, /role="status"/);
});

test("ships the Kanban, Supabase, and collaboration capabilities", async () => {
  const [board, panels, packageJson, schema] = await Promise.all([
    readFile(new URL("../app/components/BoardApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TaskPanels.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"@dnd-kit\/core"/);
  assert.match(packageJson, /"@supabase\/supabase-js"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(board, /signInAnonymously\(\)/);
  assert.match(board, /DndContext/);
  assert.match(board, /postgres_changes/);
  assert.match(board, /DEMO_STORAGE_KEY/);
  assert.match(panels, /Comments/);
  assert.match(panels, /Activity/);

  for (const table of ["tasks", "team_members", "task_assignees", "comments", "labels", "task_labels", "activity_logs"]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(schema, /auth\.uid\(\)/);
  assert.match(schema, /revoke all on table public\.tasks from public, anon/i);
  assert.match(schema, /grant select on table public\.activity_logs to authenticated/i);
  assert.match(schema, /create trigger tasks_log_activity/i);

  await access(new URL("../public/og-v2.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
});
