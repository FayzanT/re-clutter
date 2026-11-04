import { describe, expect, it } from "vitest";
import { filesPredateStatus, type TerraformFiles } from "./types";

const answer = (over: Partial<TerraformFiles>): TerraformFiles => ({
  generated: true,
  current: false,
  files: { "main.tf": "main" },
  status: null,
  ...over,
});

describe("filesPredateStatus", () => {
  it("is true for files with no status", () => {
    expect(filesPredateStatus(answer({}))).toBe(true);
  });

  it("is false before the first answer", () => {
    expect(filesPredateStatus(undefined)).toBe(false);
  });

  it("is false when nothing has been generated, so the first save is still waited for", () => {
    expect(filesPredateStatus(answer({ generated: false, files: {} }))).toBe(false);
  });

  it("is false once a status exists, however old", () => {
    const status = { state: "success" as const, finishedAt: "2026-11-04T10:00:00Z" };
    expect(filesPredateStatus(answer({ status }))).toBe(false);
  });
});
