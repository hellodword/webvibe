import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeFakePolicy(dir: string): Promise<string> {
  const fake = path.resolve("test/fixtures/fake-upstream.mjs");
  const policyPath = path.join(dir, "policy.yaml");
  await writeFile(
    policyPath,
    `version: 2
mode: dev
workspace:
  root: "\${workspaceRoot}"
  protected:
    - ".env"
upstreams:
  main:
    transport: stdio
    command: "${process.execPath}"
    args:
      - "${fake}"
  missing:
    transport: stdio
    command: "__webvibe_missing_command__"
    optional: true
  tasks:
    transport: local-task-runner
    cwd: "\${workspaceRoot}"
    tasks:
      echo:
        executable: "${process.execPath}"
        args:
          - "-e"
          - "console.log('task-ok')"
        defaultTimeoutSeconds: 2
      slow_task:
        executable: "${process.execPath}"
        args:
          - "-e"
          - "setTimeout(() => console.log('slow-task-ok'), 1200)"
        defaultTimeoutSeconds: 2
        maxTimeoutSeconds: 2
tools:
  - name: workspace.context
    type: builtIn
  - name: diagnostics.health
    type: builtIn
  - name: fs.read
    type: builtIn
    inputSchema:
      type: object
      properties:
        path:
          type: string
        byteOffset:
          type: integer
          minimum: 0
        range:
          type: object
          properties:
            startLine:
              type: integer
              minimum: 1
            endLine:
              type: integer
              minimum: 1
          required: [startLine, endLine]
          additionalProperties: false
        maxBytes:
          type: integer
          minimum: 1
          maximum: 131072
      required: [path]
      additionalProperties: false
  - name: fs.read_many
    type: builtIn
    inputSchema:
      type: object
      properties:
        files:
          type: array
          minItems: 1
          maxItems: 50
          items:
            type: object
            properties:
              path:
                type: string
              byteOffset:
                type: integer
                minimum: 0
              maxBytes:
                type: integer
                minimum: 1
                maximum: 131072
              range:
                type: object
                properties:
                  startLine:
                    type: integer
                    minimum: 1
                  endLine:
                    type: integer
                    minimum: 1
                required: [startLine, endLine]
                additionalProperties: false
            required: [path]
            additionalProperties: false
        maxBytesPerFile:
          type: integer
          minimum: 1
          maximum: 131072
      required: [files]
      additionalProperties: false
  - name: change.apply
    type: builtIn
    annotations:
      readOnlyHint: false
      destructiveHint: true
      openWorldHint: false
  - name: task.run
    type: builtIn
    inputSchema:
      type: object
      properties:
        taskId:
          type: string
        mode:
          type: string
          enum: [foreground, background]
      required: [taskId]
      additionalProperties: false
  - name: task.explain
    type: builtIn
    inputSchema:
      type: object
      properties:
        taskId:
          type: string
      required: [taskId]
      additionalProperties: false
  - name: task.result
    type: builtIn
    inputSchema:
      type: object
      properties:
        runId:
          type: string
      required: [runId]
      additionalProperties: false
  - name: x.read
    type: passThrough
    upstream: main
    upstreamTool: read
    inputPolicy:
      pathFields: ["path"]
    annotations:
      readOnlyHint: true
      destructiveHint: false
      openWorldHint: false
  - name: x.optional
    type: passThrough
    upstream: missing
    upstreamTool: read
    optional: true
  - name: x.edit_preview
    type: passThrough
    upstream: main
    upstreamTool: edit
    inputPolicy:
      require:
        dryRun: true
      pathFields: ["path"]
    annotations:
      readOnlyHint: false
      destructiveHint: false
      openWorldHint: false
  - name: x.edit_apply
    type: passThrough
    upstream: main
    upstreamTool: edit
    inputPolicy:
      require:
        dryRun: false
      pathFields: ["path"]
    annotations:
      readOnlyHint: false
      destructiveHint: true
      openWorldHint: false
  - name: x.run
    type: workflow
    optional: true
    description: Run fake workflow
    inputSchema:
      type: object
      properties:
        timeoutSeconds:
          type: integer
      additionalProperties: false
    steps:
      - call:
          upstream: main
          tool: run
          input:
            command: "npm test"
            timeout_ms: "\${coalesce(input.timeoutSeconds, 5) * 1000}"
  - name: x.slow
    type: workflow
    description: Run slow fake workflow
    inputSchema:
      type: object
      properties:
        delayMs:
          type: integer
      required: ["delayMs"]
      additionalProperties: false
    timeoutSeconds:
      default: 1
      maximum: 1
    steps:
      - call:
          upstream: main
          tool: slow
          input:
            delayMs: "\${input.delayMs}"
limits:
  http:
    oauthMaxBodyBytes: 200
    mcpMaxBodyBytes: 2000
  output:
    maxToolOutputBytes: 60000
  task:
    defaultTimeoutSeconds: 300
  rate:
    maxCallsPerMinute: 120
audit:
  enabled: true
  maxLogBytes: 10485760
  payloads: full-redacted
  includeClientVisibleOutput: true
  includeRawToolOutput: true
  includeErrors: true
  includeErrorStack: true
  includeManualEvents: true
  redact: true
`,
  );
  return policyPath;
}
