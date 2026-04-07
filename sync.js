import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const BACKLOG_SPACE  = process.env.BACKLOG_SPACE;
const BACKLOG_API_KEY = process.env.BACKLOG_API_KEY;
const BACKLOG_PROJECT_ID = process.env.BACKLOG_PROJECT_ID;
const NOTION_DB_ID   = process.env.NOTION_DATABASE_ID;

// ① Notionから5分以内に更新されたページを取得
const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

const { results } = await notion.databases.query({
  database_id: NOTION_DB_ID,
  filter: {
    timestamp: 'last_edited_time',
    last_edited_time: { on_or_after: since }
  }
});

console.log(`対象ページ数: ${results.length}`);

for (const page of results) {
  const props = page.properties;

  const summary     = props['タイトル']?.title?.[0]?.plain_text ?? '無題';
  const description = props['詳細']?.rich_text?.[0]?.plain_text ?? '';
  const dueDate     = props['期日']?.date?.start ?? null;

  const existingIssueId = props['BacklogID']?.number ?? null;

  if (existingIssueId) {
    await updateBacklogIssue(existingIssueId, { summary, description, dueDate });
  } else {
    const newIssueId = await createBacklogIssue({ summary, description, dueDate });
    await writeBacklogIdToNotion(page.id, newIssueId);
  }
}

// ── Backlog API ──────────────────────────

async function createBacklogIssue({ summary, description, dueDate }) {
  const body = new URLSearchParams({
    projectId: BACKLOG_PROJECT_ID,
    summary,
    description: description ?? '',
    issueTypeId: '12345', // ← 必須
    priorityId: '3',
    ...(dueDate && { dueDate }),
  });

  const res = await fetch(
    `https://${BACKLOG_SPACE}/api/v2/issues?apiKey=${BACKLOG_API_KEY}`,
    { method: 'POST', body }
  );

  const data = await res.json();

  console.log('Backlog raw response:', data);

  if (!data.id) {
    throw new Error('Backlog issue creation failed');
  }

  if (!res.ok) {
    console.error('Backlog API Error:', data);
    throw new Error('Backlog API failed');
  }

  console.log(`Backlog課題作成: #${data.issueKey}`);
  return data.id;
}

async function updateBacklogIssue(issueId, { summary, description, dueDate }) {
  const body = new URLSearchParams({
    summary,
    description: description ?? '',
    ...(dueDate && { dueDate }),
  });

  await fetch(
    `https://${BACKLOG_SPACE}/api/v2/issues/${issueId}?apiKey=${BACKLOG_API_KEY}`,
    { method: 'PATCH', body }
  );

  console.log(`Backlog課題更新: ID=${issueId}`);
}

async function writeBacklogIdToNotion(pageId, backlogIssueId) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      BacklogID: {
        number: backlogIssueId
      }
    }
  });
}