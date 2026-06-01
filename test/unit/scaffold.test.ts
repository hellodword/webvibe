import { describe, expect, it } from "vitest";

import { main } from "../../src/main.js";

describe("scaffold", () => {
  it("exports an async main", async () => {
    await expect(main()).resolves.toBeUndefined();
  });
});
