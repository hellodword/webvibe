import { describe, expect, it } from "vitest";

import { readMcpResource } from "../../src/server/resources.js";

describe("manual gate widget resource", () => {
  it("returns the fixed MCP app HTML resource", () => {
    const resource = readMcpResource({
      uri: "ui://webvibe/manual-gate.html",
      publicBaseUrl: "http://127.0.0.1:7777",
    });

    expect(resource.contents[0]).toMatchObject({
      uri: "ui://webvibe/manual-gate.html",
      mimeType: "text/html;profile=mcp-app",
    });
    expect(resource.contents[0]._meta.ui.csp.connectDomains).toEqual(["http://127.0.0.1:7777"]);
  });

  it("renders generic completion controls and only calls manual.confirm", () => {
    const html = readMcpResource({
      uri: "ui://webvibe/manual-gate.html",
      publicBaseUrl: "http://localhost:3000",
    }).contents[0].text;

    expect(html).toContain("I completed this manually");
    expect(html).toContain("Cancel");
    expect(html).toContain("Manual output or logs");
    expect(html).toContain("Evidence note");
    expect(html).toContain("loadDetail");
    expect(html).toContain("fetch(detailUrl");
    expect(html).toContain("manual.confirm");
    expect(html).toContain("sendFollowUpMessage");
    expect(html).toContain("This manual completion card requires the ChatGPT Apps widget runtime.");
    expect(html).not.toContain("apply patch");
    expect(html).not.toContain("git apply");
    expect(html).not.toContain("delete files");
    expect(html).not.toContain("rm ");

    const calledTools = [...html.matchAll(/callTool\("([^"]+)"/g)].map((match) => match[1]);
    expect(calledTools).toEqual(["manual.confirm"]);
  });

  it("rejects unknown resource URIs", () => {
    expect(() =>
      readMcpResource({ uri: "ui://webvibe/other.html", publicBaseUrl: "http://localhost" }),
    ).toThrow("Unsupported MCP resource URI");
  });
});
