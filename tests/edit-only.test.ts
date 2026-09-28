import { describe, expect, it } from "vitest";
import { transformZip, writeZip } from "../src/workflow.js";

function archiveText(files: Record<string, string>): Uint8Array {
  return writeZip(Object.entries(files).map(([path, text]) => ({
    path,
    bytes: new TextEncoder().encode(text),
  })));
}

describe("edit-only transformation", () => {
  it("returns source and report without creating build artifacts", async () => {
    const input = archiveText({
      "src/provider.ts": "import woltClient from 'wolt';\nexport function create_gmail_account() { return 'review'; }\n",
      "README.md": "Edit this repository only.",
    });

    const result = await transformZip(input);
    const report = result.scan.report;
    const output = new TextDecoder().decode(result.packageBytes);

    expect(result.packageBytes.length).toBeGreaterThan(0);
    expect(report).toContain("Generated module: src/gmail_autogen/index.ts");
    expect(report).toContain("Removed Wolt-specific lines: 1");
    expect(output).not.toContain("dist/");
    expect(output).not.toContain("build/");
    expect(output).not.toContain("node_modules/");
  });
});
