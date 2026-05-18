import { access, constants, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

const MAX_READ_LINES = 2_000;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// Path resolution — confined to FILE_TOOLS_ROOT (defaults to process.cwd())
// ---------------------------------------------------------------------------

const FILE_TOOLS_ROOT = normalize(
  resolve(process.env.FILE_TOOLS_ROOT ?? process.cwd())
);

/**
 * Resolves `userPath` to an absolute path and ensures it stays within FILE_TOOLS_ROOT.
 * Returns `{ ok: false }` when the tool is disabled or the path escapes the root.
 */
function safePath(
  userPath: string
): { ok: true; resolved: string } | { ok: false; code: string; message: string } {
  if (process.env.FILE_TOOLS_ENABLED !== "true") {
    return {
      ok: false,
      code: "TOOL_DISABLED",
      message: "File tools are disabled. Set FILE_TOOLS_ENABLED=true to enable them.",
    };
  }

  const resolved = normalize(isAbsolute(userPath) ? userPath : resolve(FILE_TOOLS_ROOT, userPath));

  // Ensure path is inside FILE_TOOLS_ROOT (add sep to prevent prefix-only match)
  if (resolved !== FILE_TOOLS_ROOT && !resolved.startsWith(FILE_TOOLS_ROOT + sep)) {
    return {
      ok: false,
      code: "PATH_OUTSIDE_ROOT",
      message: `Access denied: path is outside the allowed root (${FILE_TOOLS_ROOT}).`,
    };
  }

  return { ok: true, resolved };
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export interface ReadFileInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadFileSuccess {
  ok: true;
  tool: "read_file";
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

export interface ReadFileFailure {
  ok: false;
  tool: "read_file";
  path: string;
  error: { code: string; message: string };
}

export type ReadFileResult = ReadFileSuccess | ReadFileFailure;

export async function executeReadFile(input: ReadFileInput): Promise<ReadFileResult> {
  const safe = safePath(input.path);
  if (!safe.ok) {
    return { ok: false, tool: "read_file", path: input.path, error: { code: safe.code, message: safe.message } };
  }

  const { resolved } = safe;

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(resolved);
  } catch {
    return { ok: false, tool: "read_file", path: resolved, error: { code: "NOT_FOUND", message: `File not found: ${resolved}` } };
  }

  if (fileStat.isDirectory()) {
    return { ok: false, tool: "read_file", path: resolved, error: { code: "IS_DIRECTORY", message: `Path is a directory, not a file: ${resolved}` } };
  }

  if (fileStat.size > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      tool: "read_file",
      path: resolved,
      error: {
        code: "FILE_TOO_LARGE",
        message: `File is ${fileStat.size} bytes, which exceeds the ${MAX_CONTENT_BYTES / 1024 / 1024} MB limit. Use offset and limit to read a specific line range.`,
      },
    };
  }

  let raw: string;
  try {
    raw = await readFile(resolved, "utf8");
  } catch (err) {
    return { ok: false, tool: "read_file", path: resolved, error: { code: "READ_ERROR", message: String(err) } };
  }

  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  const startLine = input.offset ?? 1;
  const maxLines = input.limit ?? MAX_READ_LINES;

  if (startLine < 1 || startLine > totalLines) {
    return {
      ok: false,
      tool: "read_file",
      path: resolved,
      error: {
        code: "OFFSET_OUT_OF_RANGE",
        message: `offset ${startLine} is out of range. File has ${totalLines} lines (1-based).`,
      },
    };
  }

  // Slice is 0-based internally
  const sliced = allLines.slice(startLine - 1, startLine - 1 + maxLines);
  const endLine = startLine + sliced.length - 1;

  return {
    ok: true,
    tool: "read_file",
    path: resolved,
    content: sliced.join("\n"),
    startLine,
    endLine,
    totalLines,
  };
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface WriteFileSuccess {
  ok: true;
  tool: "write_file";
  path: string;
  bytesWritten: number;
}

export interface WriteFileFailure {
  ok: false;
  tool: "write_file";
  path: string;
  error: { code: string; message: string };
}

export type WriteFileResult = WriteFileSuccess | WriteFileFailure;

export async function executeWriteFile(input: WriteFileInput): Promise<WriteFileResult> {
  const safe = safePath(input.path);
  if (!safe.ok) {
    return { ok: false, tool: "write_file", path: input.path, error: { code: safe.code, message: safe.message } };
  }

  const { resolved } = safe;

  // Check file does NOT already exist
  try {
    await access(resolved, constants.F_OK);
    // If we get here the file exists → fail
    return {
      ok: false,
      tool: "write_file",
      path: resolved,
      error: {
        code: "FILE_EXISTS",
        message: `File already exists: ${resolved}. Use edit_file to modify an existing file.`,
      },
    };
  } catch {
    // access threw → file does not exist, which is what we want
  }

  // Create parent directories
  try {
    await mkdir(dirname(resolved), { recursive: true });
  } catch (err) {
    return { ok: false, tool: "write_file", path: resolved, error: { code: "MKDIR_ERROR", message: `Could not create parent directories: ${String(err)}` } };
  }

  // Write using 'wx' flag to fail if another process races and creates the file
  const bytes = Buffer.from(input.content, "utf8");
  try {
    const fh = await open(resolved, "wx");
    try {
      await fh.write(bytes);
    } finally {
      await fh.close();
    }
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "EEXIST") {
      return {
        ok: false,
        tool: "write_file",
        path: resolved,
        error: { code: "FILE_EXISTS", message: `File already exists: ${resolved}. Use edit_file to modify an existing file.` },
      };
    }
    return { ok: false, tool: "write_file", path: resolved, error: { code: "WRITE_ERROR", message: String(err) } };
  }

  return { ok: true, tool: "write_file", path: resolved, bytesWritten: bytes.length };
}

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

export interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
}

export interface EditFileSuccess {
  ok: true;
  tool: "edit_file";
  path: string;
  replacements: 1;
}

export interface EditFileFailure {
  ok: false;
  tool: "edit_file";
  path: string;
  error: { code: string; message: string };
}

export type EditFileResult = EditFileSuccess | EditFileFailure;

export async function executeEditFile(input: EditFileInput): Promise<EditFileResult> {
  const safe = safePath(input.path);
  if (!safe.ok) {
    return { ok: false, tool: "edit_file", path: input.path, error: { code: safe.code, message: safe.message } };
  }

  const { resolved } = safe;

  let original: string;
  try {
    original = await readFile(resolved, "utf8");
  } catch {
    return { ok: false, tool: "edit_file", path: resolved, error: { code: "NOT_FOUND", message: `File not found: ${resolved}` } };
  }

  // Count occurrences without regex to support arbitrary strings
  const occurrences = countOccurrences(original, input.old_string);

  if (occurrences === 0) {
    return {
      ok: false,
      tool: "edit_file",
      path: resolved,
      error: {
        code: "OLD_STRING_NOT_FOUND",
        message: `old_string was not found in the file. Make sure the text matches exactly (including whitespace and line endings).`,
      },
    };
  }

  if (occurrences > 1) {
    return {
      ok: false,
      tool: "edit_file",
      path: resolved,
      error: {
        code: "OLD_STRING_AMBIGUOUS",
        message: `old_string appears ${occurrences} times in the file. Provide more surrounding context in old_string so it matches exactly once.`,
      },
    };
  }

  const updated = original.replace(input.old_string, input.new_string);

  // Write atomically: write to a temp file then rename into place
  const tmp = resolve(dirname(resolved), `.tmp_${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(tmp, updated, "utf8");
    await rename(tmp, resolved);
  } catch (err) {
    // Best-effort cleanup of temp file
    try { await access(tmp); /* exists */ await writeFile(tmp, ""); } catch { /* ignore */ }
    return { ok: false, tool: "edit_file", path: resolved, error: { code: "WRITE_ERROR", message: String(err) } };
  }

  return { ok: true, tool: "edit_file", path: resolved, replacements: 1 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
