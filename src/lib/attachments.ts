import { del, get, put } from "@vercel/blob";
import { newId, nowISO, isBlobStore } from "./store";
import { ApiError } from "./api";
import type { SubmissionAttachment } from "./types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 20;

export const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "application/zip",
];

export interface IncomingFile {
  filename: string;
  content_type: string;
  data_url: string;
}

const DATA_URL_RE = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/]+/g, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 120) || "file"
  );
}

function decodeDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) return null;
  return { contentType, buffer };
}

export function attachmentDisposition(attachment: SubmissionAttachment): string {
  const safe = sanitizeFilename(attachment.filename).replace(/["\\]/g, "_");
  return `attachment; filename="${safe}"`;
}

export interface PreparedAttachment {
  record: Omit<SubmissionAttachment, "uploaded_at">;
  buffer: Buffer;
}

/**
 * Validates one uploaded file. Throws ApiError(400) when the data URL is
 * malformed, the type is not on the allowlist, or the size exceeds the cap.
 * The declared content_type must match the actual data-URL media type.
 */
export function prepareAttachment(
  file: IncomingFile,
  assignmentId: string,
  uploaderId: string
): PreparedAttachment {
  const declared = file.content_type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_ATTACHMENT_TYPES.includes(declared)) {
    throw new ApiError(400, `File type not allowed: ${file.filename}`);
  }
  const decoded = decodeDataUrl(file.data_url);
  if (!decoded) {
    throw new ApiError(400, `File is not valid base64 data: ${file.filename}`);
  }
  const declaredBase = declared === "image/jpg" ? "image/jpeg" : declared;
  const actualBase = decoded.contentType === "image/jpg" ? "image/jpeg" : decoded.contentType;
  if (declaredBase !== actualBase) {
    throw new ApiError(400, `File content does not match its declared type: ${file.filename}`);
  }
  if (decoded.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(400, `File exceeds the 10 MB limit: ${file.filename}`);
  }
  const filename = sanitizeFilename(file.filename);
  const id = newId("att");
  return {
    record: {
      id,
      assignment_id: assignmentId,
      filename,
      content_type: declared,
      size: decoded.buffer.length,
      data_url: null,
      blob_pathname: null,
      uploaded_by: uploaderId,
    },
    buffer: decoded.buffer,
  };
}

/**
 * Persists a prepared attachment. On Vercel the bytes go to a private Blob;
 * locally they stay inline in the JSON store. Returns the stored record.
 */
export async function storeAttachment(prepared: PreparedAttachment): Promise<SubmissionAttachment> {
  const { record, buffer } = prepared;
  if (isBlobStore()) {
    const pathname = `attachments/${record.id}/${encodeURIComponent(record.filename)}`;
    await put(pathname, buffer, {
      access: "private",
      contentType: record.content_type,
    });
    return { ...record, blob_pathname: pathname, uploaded_at: nowISO() };
  }
  const dataUrl = `data:${record.content_type};base64,${buffer.toString("base64")}`;
  return { ...record, data_url: dataUrl, uploaded_at: nowISO() };
}

/** Deletes blobs for the given pathnames; best-effort, never throws. */
export async function deleteAttachmentBlobs(pathnames: (string | null | undefined)[]): Promise<void> {
  const targets = pathnames.filter(
    (p): p is string => typeof p === "string" && p.startsWith("attachments/")
  );
  if (!targets.length) return;
  try {
    await del(targets);
  } catch (err) {
    console.error("[attachments] blob delete failed", err);
  }
}

/** Fetches attachment bytes (Vercel Blob mode only; local mode uses data_url). */
export async function readAttachmentBlob(
  pathname: string
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || !result.stream) throw new ApiError(404, "File no longer exists in storage");
  return { stream: result.stream, contentType: result.blob.contentType ?? "application/octet-stream" };
}
