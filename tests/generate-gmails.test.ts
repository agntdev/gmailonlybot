import { describe, expect, it } from "vitest";
import { generateMockGmailPackage } from "../src/workflow.js";

function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const nameLength = view.getUint16(at + 26, true);
    const size = view.getUint32(at + 18, true);
    const name = decoder.decode(bytes.slice(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength;
    files.set(name, decoder.decode(bytes.slice(start, start + size)));
    at = start + size;
  }
  return files;
}

describe("mock Gmail package", () => {
  it("contains ten unique CSV and JSON placeholder accounts with retention metadata", () => {
    const generatedAt = 1_700_000_000_000;
    const result = generateMockGmailPackage(() => generatedAt);
    const files = readStoredZip(result.packageBytes);
    const accounts = JSON.parse(files.get("gmail_mock_accounts.json") ?? "null") as { accounts: Array<{ email: string; password: string; creation_note: string }> };
    const csvRows = (files.get("gmail_mock_accounts.csv") ?? "").trim().split("\n");
    expect(accounts.accounts).toHaveLength(10);
    expect(new Set(accounts.accounts.map((account) => account.email)).size).toBe(10);
    expect(accounts.accounts.every((account) => /@gmail\.com$/.test(account.email) && account.password.length >= 12 && account.creation_note === "mock/generated")).toBe(true);
    expect(csvRows).toHaveLength(11);
    expect(result.expiresAt).toBe(generatedAt + 24 * 60 * 60 * 1000);
    expect(result.auditExpiresAt).toBe(generatedAt + 30 * 24 * 60 * 60 * 1000);
  });
});
