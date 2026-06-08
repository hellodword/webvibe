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
    expect(resource.contents[0]._meta.ui.domain).toBe("http://127.0.0.1:7777");
    expect(resource.contents[0]._meta["openai/widgetDomain"]).toBe("http://127.0.0.1:7777");
    expect(resource.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
  });

  it("normalizes widget domain metadata from publicBaseUrl origin", () => {
    const resource = readMcpResource({
      uri: "ui://webvibe/manual-gate.html",
      publicBaseUrl: "https://mcp.example.com/some/path/",
    });

    expect(resource.contents[0]._meta.ui.domain).toBe("https://mcp.example.com");
    expect(resource.contents[0]._meta["openai/widgetDomain"]).toBe("https://mcp.example.com");
    expect(resource.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
  });

  it("renders generic completion controls and only calls manual.confirm", () => {
    const html = readMcpResource({
      uri: "ui://webvibe/manual-gate.html",
      publicBaseUrl: "http://localhost:3000",
    }).contents[0].text;

    expect(html).toContain("I completed this manually");
    expect(html).toContain("Cancel");
    expect(html).toContain("Log file path");
    expect(html).toContain("manualLogPath");
    expect(html).toContain("width: min(100%, 680px)");
    expect(html).not.toContain("Evidence note");
    expect(html).not.toContain("Output format");
    expect(html).not.toContain("loadDetail");
    expect(html).not.toContain("fetch(detailUrl");
    expect(html).not.toContain("manualOutput");
    expect(html).not.toContain("manualOutputFormat");
    expect((html.match(/document.createElement\("textarea"\)/g) ?? []).length).toBe(1);
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
