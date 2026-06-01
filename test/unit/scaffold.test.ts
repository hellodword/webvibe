import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../../src/config/loader.js";

describe("scaffold", () => {
  it("parses base CLI flags", () => {
    expect(
      parseCliArgs([
        "--mode",
        "dev",
        "--workspace",
        ".",
        "--public-base-url=http://127.0.0.1:3000",
        "--pairing-code",
        "123456",
      ]),
    ).toMatchObject({
      mode: "dev",
      workspace: ".",
      publicBaseUrl: "http://127.0.0.1:3000",
      pairingCode: "123456",
    });
  });
});
