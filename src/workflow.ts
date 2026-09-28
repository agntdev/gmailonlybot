import type { Ctx } from "./bot.js";

export type JobStatus = "queued" | "running" | "complete" | "failed" | "manual_review_required";
export interface Job {
  id: string;
  source: "git_url" | "upload";
  name: string;
  status: JobStatus;
  summary: string;
  flags: string[];
  createdAt: number;
}

export interface WorkflowSession {
  jobs?: Job[];
  awaitingUpload?: boolean;
  awaitingUrl?: boolean;
  maxRepoBytes?: number;
  returnOriginalSnippets?: boolean;
}

let testNow: (() => number) | undefined;
export function now(): number {
  return testNow?.() ?? Date.now();
}
export function _setNowForTests(clock?: () => number): void {
  testNow = clock;
}

export function workflowSession(ctx: Ctx): WorkflowSession {
  return ctx.session as WorkflowSession;
}

export function nextJobId(ctx: Ctx): string {
  const jobs = workflowSession(ctx).jobs ?? [];
  return `job-${now().toString(36)}-${jobs.length + 1}`;
}

export function rememberJob(ctx: Ctx, job: Job): void {
  const session = workflowSession(ctx);
  const jobs = session.jobs ?? [];
  session.jobs = [job, ...jobs].slice(0, 20);
}

export function githubUrl(value: string): { ok: true; name: string } | { ok: false } {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com") return { ok: false };
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) return { ok: false };
    return { ok: true, name: `${parts[0]}/${parts[1].replace(/\.git$/, "")}` };
  } catch {
    return { ok: false };
  }
}

export interface ScanResult {
  files: string[];
  removedLines: number;
  gmailLines: number;
  flags: string[];
  report: string;
}

interface ArchiveFile { path: string; bytes: Uint8Array; }

function u16(bytes: Uint8Array, at: number): number { return bytes[at]! | (bytes[at + 1]! << 8); }
function u32(bytes: Uint8Array, at: number): number { return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0; }
function put16(out: Uint8Array, at: number, value: number): void { out[at] = value & 255; out[at + 1] = (value >>> 8) & 255; }
function put32(out: Uint8Array, at: number, value: number): void { out[at] = value & 255; out[at + 1] = (value >>> 8) & 255; out[at + 2] = (value >>> 16) & 255; out[at + 3] = (value >>> 24) & 255; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(bytes: Uint8Array): Promise<ArchiveFile[]> {
  const limit = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= limit; i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("corrupt_zip");
  const count = u16(bytes, eocd + 10);
  const central = u32(bytes, eocd + 16);
  let at = central;
  const files: ArchiveFile[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error("corrupt_zip");
    const method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/") || name.includes("..")) continue;
    if (files.length >= 10000 || compressedSize > 50 * 1024 * 1024) throw new Error("too_large");
    const localNameLength = u16(bytes, local + 26);
    const localExtraLength = u16(bytes, local + 28);
    const data = bytes.slice(local + 30 + localNameLength + localExtraLength, local + 30 + localNameLength + localExtraLength + compressedSize);
    if (method !== 0 && method !== 8) continue;
    files.push({ path: name, bytes: method === 8 ? await inflate(data) : data });
  }
  return files;
}

function writeZip(files: ReadonlyArray<ArchiveFile>): Uint8Array {
  const names = files.map((file) => new TextEncoder().encode(file.path));
  const localSize = files.reduce((sum, file, i) => sum + 30 + names[i]!.length + file.bytes.length, 0);
  const centralSize = files.reduce((sum, file, i) => sum + 46 + names[i]!.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  let at = 0;
  const offsets: number[] = [];
  files.forEach((file, i) => {
    offsets.push(at); const name = names[i]!; const crc = crc32(file.bytes);
    put32(out, at, 0x04034b50); put16(out, at + 4, 20); put16(out, at + 8, 0); put16(out, at + 10, 0); put16(out, at + 14, 0); put32(out, at + 18, crc); put32(out, at + 22, file.bytes.length); put32(out, at + 26, file.bytes.length); put16(out, at + 28, name.length); put16(out, at + 30, 0); out.set(name, at + 32); out.set(file.bytes, at + 32 + name.length); at += 32 + name.length + file.bytes.length;
  });
  const centralAt = at;
  files.forEach((file, i) => { const name = names[i]!; const crc = crc32(file.bytes); put32(out, at, 0x02014b50); put16(out, at + 4, 20); put16(out, at + 6, 20); put16(out, at + 8, 0); put16(out, at + 10, 0); put32(out, at + 16, crc); put32(out, at + 20, file.bytes.length); put32(out, at + 24, file.bytes.length); put16(out, at + 28, name.length); put16(out, at + 30, 0); put16(out, at + 32, 0); put16(out, at + 34, 0); put16(out, at + 36, 0); put32(out, at + 38, 0); put32(out, at + 42, offsets[i]!); out.set(name, at + 46); at += 46 + name.length; });
  put32(out, at, 0x06054b50); put16(out, at + 8, 0); put16(out, at + 10, 0); put16(out, at + 8, files.length); put16(out, at + 10, files.length); put32(out, at + 12, at - centralAt); put32(out, at + 16, centralAt); return out;
}

export async function transformZip(input: Uint8Array): Promise<{ packageBytes: Uint8Array; scan: ScanResult }> {
  const files = await readZip(input);
  const textFiles: Array<{ path: string; text: string }> = [];
  const binary = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".zip", ".exe"]);
  for (const file of files) {
    const ext = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
    if (!binary.has(ext) && file.bytes.length <= 2 * 1024 * 1024) textFiles.push({ path: file.path, text: new TextDecoder().decode(file.bytes) });
  }
  const scan = scanTextFiles(textFiles);
  const changed = new Set(scan.files.map((item) => item.slice(0, item.lastIndexOf(":"))));
  const output = files.filter((file) => !changed.has(file.path)).map((file) => {
    const text = textFiles.find((candidate) => candidate.path === file.path);
    if (!text) return file;
    const lines = text.text.split("\\n").filter((line) => !/wolt|wolt[_-]?api|wolt[_-]?client/i.test(line));
    return { path: file.path, bytes: new TextEncoder().encode(lines.join("\\n")) };
  });
  const gmail = textFiles.flatMap((file) => file.text.split("\\n").filter((line) => /gmail|create[_-]?gmail|gmail[_-]?account|oauth|smtp/i.test(line)).map((line) => `// ${file.path}\n${line}`));
  if (gmail.length) output.push({ path: "src/gmail_autogen/index.ts", bytes: new TextEncoder().encode(["// Consolidated by Repo Sanitizer. Review before use.", ...gmail].join("\\n")) });
  return { packageBytes: writeZip(output), scan };
}

/** Transform text files without executing repository code. */
export function scanTextFiles(files: ReadonlyArray<{ path: string; text: string }>): ScanResult {
  const removed: string[] = [];
  const gmail: string[] = [];
  const flags: string[] = [];
  let removedLines = 0;
  let gmailLines = 0;
  for (const file of files) {
    const lines = file.text.split("\\n");
    const kept: string[] = [];
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      if (/wolt|wolt[_-]?api|wolt[_-]?client/.test(lower)) {
        removedLines += 1;
        removed.push(`${file.path}:${index + 1}`);
        if (/[=:({].*(wolt|client)|import .*wolt/.test(lower)) flags.push(`${file.path}:${index + 1}`);
        return;
      }
      if (/gmail|create[_-]?gmail|gmail[_-]?account|oauth|smtp/.test(lower)) {
        gmail.push(`// ${file.path}:${index + 1}\n${line}`);
        gmailLines += 1;
      }
      kept.push(line);
    });
  }
  const report = [
    "Repo Sanitizer change report",
    `Removed Wolt-specific lines: ${removedLines}`,
    `Gmail-related lines consolidated: ${gmailLines}`,
    removed.length ? `Removed items:\n${removed.map((x) => `- ${x}`).join("\n")}` : "Removed items: none",
    flags.length
      ? `MANUAL REVIEW REQUIRED\nAmbiguous snippets:\n${flags.map((x) => `- ${x}`).join("\n")}\nOriginal and modified snippets must be reviewed before deployment.`
      : "Manual review: not required",
    gmailLines ? "Generated module: src/gmail_autogen/index.ts" : "No Gmail-related logic found; source was otherwise left unchanged.",
  ].join("\n");
  return { files: removed, removedLines, gmailLines, flags, report };
}

export function trimForTelegram(value: string): string {
  return value.length <= 3800 ? value : `${value.slice(0, 3790)}\\n[Report shortened for Telegram]`;
}
