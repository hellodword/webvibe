import { BadRequestError } from "../util/errors.js";

export const MANUAL_GATE_RESOURCE_URI = "ui://webvibe/manual-gate.html";

export function readMcpResource(input: { uri: string; publicBaseUrl: string }): {
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
        domain: string;
      };
      "openai/outputTemplate": string;
      "openai/widgetDomain": string;
      "openai/widgetDescription": string;
    };
  }>;
} {
  if (input.uri !== MANUAL_GATE_RESOURCE_URI) {
    throw new BadRequestError(`Unsupported MCP resource URI: ${input.uri}`);
  }
  const widgetDomain = new URL(input.publicBaseUrl).origin;
  return {
    contents: [
      {
        uri: MANUAL_GATE_RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: manualGateHtml(),
        _meta: {
          ui: {
            prefersBorder: true,
            domain: widgetDomain,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          "openai/outputTemplate": MANUAL_GATE_RESOURCE_URI,
          "openai/widgetDomain": widgetDomain,
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
html { box-sizing: border-box; width: 100%; }
*, *::before, *::after { box-sizing: inherit; }
body { margin: 0; padding: 16px; width: 100%; overflow-x: hidden; color: CanvasText; background: Canvas; }
.wrap { display: grid; gap: 14px; width: min(100%, 680px); max-width: 100%; margin-inline: auto; }
.section { display: grid; gap: 6px; }
.label { font-weight: 650; font-size: 12px; text-transform: uppercase; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button { border: 1px solid color-mix(in srgb, CanvasText 28%, Canvas); border-radius: 6px; padding: 8px 12px; background: ButtonFace; color: ButtonText; cursor: pointer; }
button.primary { background: Highlight; color: HighlightText; border-color: Highlight; }
button:disabled { opacity: .6; cursor: default; }
textarea { display: block; width: 100%; max-width: 100%; border: 1px solid color-mix(in srgb, CanvasText 28%, Canvas); border-radius: 6px; padding: 8px; background: Canvas; color: CanvasText; font: inherit; }
textarea { resize: vertical; min-height: 84px; }
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
  const manualAction =
    metadata._meta?.manualAction ||
    metadata.manualAction ||
    metadata.mcp_tool_result?._meta?.manualAction ||
    metadata.call_tool_result?._meta?.manualAction ||
    {};
  const pendingId = output.pendingId || manualAction.pendingId || "";
  const confirmToken = manualAction.confirmToken || "";

  root.innerHTML = "";
  const logPath = textarea("Log file path", "manualLogPath", 500);
  root.append(logPath.section);

  const actions = document.createElement("div");
  actions.className = "actions";
  const done = button("I completed this manually", "primary");
  const cancel = button("Cancel", "");
  done.addEventListener("click", () =>
    submit("completed", pendingId, confirmToken, done, cancel, {
      manualLogPath: logPath.input.value,
    })
  );
  cancel.addEventListener("click", () =>
    submit("cancelled", pendingId, confirmToken, done, cancel, {})
  );
  actions.append(done, cancel);
  root.append(actions);
}

function button(label, className) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  return b;
}

function textarea(label, id, maxLength) {
  const section = document.createElement("section");
  section.className = "section";
  const l = document.createElement("label");
  l.className = "label";
  l.htmlFor = id;
  l.textContent = label;
  const input = document.createElement("textarea");
  input.id = id;
  input.maxLength = maxLength;
  input.rows = 3;
  section.append(l, input);
  return { section, input };
}

async function submit(outcome, pendingId, confirmToken, done, cancel, evidence) {
  done.disabled = true;
  cancel.disabled = true;
  const payload = { pendingId, confirmToken, outcome, ...evidence };
  if (outcome !== "completed") {
    delete payload.manualLogPath;
  }
  const result = await window.openai.callTool("manual.confirm", payload);
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
