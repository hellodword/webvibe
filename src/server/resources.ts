import { BadRequestError } from "../util/errors.js";

export const MANUAL_GATE_RESOURCE_URI = "ui://webvibe/manual-gate.html";

export function readMcpResource(input: {
  uri: string;
  publicBaseUrl: string;
}): {
  contents: Array<{
    uri: string;
    mimeType: "text/html;profile=mcp-app";
    text: string;
    _meta: {
      ui: {
        prefersBorder: true;
        csp: {
          connectDomains: string[];
          resourceDomains: string[];
        };
      };
      "openai/widgetDescription": string;
    };
  }>;
} {
  if (input.uri !== MANUAL_GATE_RESOURCE_URI) {
    throw new BadRequestError(`Unsupported MCP resource URI: ${input.uri}`);
  }
  return {
    contents: [
      {
        uri: MANUAL_GATE_RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: manualGateHtml(),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [new URL(input.publicBaseUrl).origin],
              resourceDomains: [],
            },
          },
          "openai/widgetDescription": "Generic manual completion card",
        },
      },
    ],
  };
}

function manualGateHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual completion</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 16px; color: CanvasText; background: Canvas; }
.wrap { display: grid; gap: 14px; max-width: 720px; }
h1 { margin: 0; font-size: 18px; line-height: 1.25; }
.muted { color: color-mix(in srgb, CanvasText 68%, Canvas); font-size: 13px; }
.section { display: grid; gap: 6px; }
.label { font-weight: 650; font-size: 12px; text-transform: uppercase; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; }
ul { margin: 0; padding-inline-start: 20px; }
li { margin-block: 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button { border: 1px solid color-mix(in srgb, CanvasText 28%, Canvas); border-radius: 6px; padding: 8px 12px; background: ButtonFace; color: ButtonText; cursor: pointer; }
button.primary { background: Highlight; color: HighlightText; border-color: Highlight; }
button:disabled { opacity: .6; cursor: default; }
.error { color: #b00020; font-weight: 650; }
</style>
</head>
<body>
<main class="wrap" id="root"></main>
<script>
const root = document.getElementById("root");
const bridge = window.openai;

function render() {
  if (!bridge) {
    root.innerHTML = '<p class="error">This manual completion card requires the ChatGPT Apps widget runtime.</p>';
    return;
  }
  const output = window.openai?.toolOutput || {};
  const metadata = window.openai?.toolResponseMetadata || {};
  const manualAction = metadata._meta?.manualAction || metadata.manualAction || {};
  const pendingId = output.pendingId || manualAction.pendingId || "";
  const title = output.title || "Manual action";
  const reason = output.reason || "manual_review_requested";
  const instructions = output.instructions || "";
  const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  const checks = Array.isArray(output.checks) ? output.checks : [];
  const expiresAt = output.expiresAt || "";
  const confirmToken = manualAction.confirmToken || "";

  root.innerHTML = "";
  root.append(heading(title), detail("Reason", reason), detail("Instructions", instructions));
  if (artifacts.length) root.append(list("Artifacts", artifacts.map(formatArtifact)));
  if (checks.length) root.append(list("Checks", checks.map(formatCheck)));
  if (expiresAt) root.append(detail("Expires at", expiresAt));

  const actions = document.createElement("div");
  actions.className = "actions";
  const done = button("I completed this manually", "primary");
  const cancel = button("Cancel", "");
  done.addEventListener("click", () => submit("completed", pendingId, confirmToken, done, cancel));
  cancel.addEventListener("click", () => submit("cancelled", pendingId, confirmToken, done, cancel));
  actions.append(done, cancel);
  root.append(actions);
}

function heading(text) {
  const h = document.createElement("h1");
  h.textContent = text;
  return h;
}

function detail(label, value) {
  const section = document.createElement("section");
  section.className = "section";
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = String(value || "");
  section.append(l, pre);
  return section;
}

function list(label, items) {
  const section = document.createElement("section");
  section.className = "section";
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.append(item);
    ul.append(li);
  }
  section.append(l, ul);
  return section;
}

function formatArtifact(artifact) {
  const span = document.createElement("span");
  const link = document.createElement("a");
  link.href = artifact.downloadUrl || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "download";
  span.textContent = [artifact.label, artifact.filename, artifact.mimeType, artifact.sizeBytes + " bytes", artifact.sha256].filter(Boolean).join(" | ") + " ";
  span.append(link);
  return span;
}

function formatCheck(check) {
  const span = document.createElement("span");
  span.textContent = JSON.stringify(check);
  return span;
}

function button(label, className) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  return b;
}

async function submit(outcome, pendingId, confirmToken, done, cancel) {
  done.disabled = true;
  cancel.disabled = true;
  const result = await window.openai.callTool("manual.confirm", { pendingId, confirmToken, outcome });
  const status = result?.structuredContent?.status || result?.status || outcome;
  const prompt = result?.structuredContent?.next?.followUpPrompt ||
    result?.next?.followUpPrompt ||
    "Manual action " + pendingId + " was confirmed with status " + status + ". Continue by verifying current workspace state with appropriate read/git/task tools before making further changes.";
  await window.openai.sendFollowUpMessage({ prompt, scrollToBottom: true });
}

render();
</script>
</body>
</html>`;
}
