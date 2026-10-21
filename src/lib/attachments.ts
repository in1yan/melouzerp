import { Binary } from "mongodb";
import { getMongo } from "./mongo";
import { newId, nowISO } from "./store";
import { ApiError } from "./api";
import type { SubmissionAttachment } from "./types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 20;

/** Collection holding the uploaded file bytes. */
export const ATTACHMENT_FILES_COLLECTION = "attachment_files";

/** Shape of a stored file document. */
interface FileDoc {
  _id: string;
  filename: string;
  content_type: string;
  size: number;
  data: unknown;
  uploaded_at: string;
}

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

const DATA_URL_RE = /^data:([a-z0-9!#$%^&*_.+-]+\/[a-z0-9!#$%^&*_.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

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
 * Persists a prepared attachment. The bytes are stored as BSON binary in a
 * dedicated collection so a 10 MB file never has to fit into a single
 * document together with its metadata.
 */
export async function storeAttachment(prepared: PreparedAttachment): Promise<SubmissionAttachment> {
  const { record, buffer } = prepared;
  const { db } = await getMongo();
  await db.collection<FileDoc>(ATTACHMENT_FILES_COLLECTION).insertOne({
    _id: record.id,
    filename: record.filename,
    content_type: record.content_type,
    size: record.size,
    data: new Binary(buffer),
    uploaded_at: nowISO(),
  });
  return { ...record, uploaded_at: nowISO() };
}

/** Deletes the stored bytes for the given attachment ids; best effort. */
export async function deleteAttachmentFiles(ids: (string | null | undefined)[]): Promise<void> {
  const targets = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!targets.length) return;
  try {
    const { db } = await getMongo();
    await db.collection<FileDoc>(ATTACHMENT_FILES_COLLECTION).deleteMany({ _id: { $in: targets } });
  } catch (err) {
    console.error("[attachments] file delete failed", err);
  }
}

function binaryToBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const binary = value as { value?: () => ArrayBuffer | Uint8Array; buffer?: ArrayBuffer; position?: number };
  if (typeof binary.value === "function") {
    const raw = binary.value();
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    return Buffer.from(new Uint8Array(raw));
  }
  if (binary.buffer) {
    return Buffer.from(
      new Uint8Array(binary.buffer, 0, binary.position ?? binary.buffer.byteLength)
    );
  }
  return null;
}

/** Reads the stored bytes of an attachment. */
export async function readAttachmentFile(
  attachmentId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const { db } = await getMongo();
  const doc = await db.collection<FileDoc>(ATTACHMENT_FILES_COLLECTION).findOne({ _id: attachmentId });
  if (!doc) return null;
  const buffer = binaryToBuffer(doc.data);
  if (!buffer) return null;
  return {
    buffer,
    contentType: String(doc.content_type ?? "application/octet-stream"),
  };
}

/** Total number of bytes and files stored for attachments. */
export async function attachmentFileStats(): Promise<{ count: number; bytes: number }> {
  const { db } = await getMongo();
  const collection = db.collection<FileDoc>(ATTACHMENT_FILES_COLLECTION);
  const count = await collection.estimatedDocumentCount();
  let bytes = 0;
  try {
    const stats = await db.command({ collStats: ATTACHMENT_FILES_COLLECTION });
    bytes = Number(stats?.size ?? 0);
  } catch {
    bytes = 0;
  }
  return { count, bytes };
}
