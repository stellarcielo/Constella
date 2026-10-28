import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "./index";

describe("core", () => {
  it("形式バージョンは 1", () => {
    expect(FORMAT_VERSION).toBe(1);
  });
});
