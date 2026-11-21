import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  sadeProjectCatalogueMaxBytes,
  sadeProjectChunkBytes,
  sadeProjectFileMaxBytes,
  type SadeProjectArtifact,
} from '../shared/sade-project.ts';
import { privateKeyHeader, redact } from './security.ts';
import { DomainError, type Store } from './store.ts';

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const transfer = { groupId: id, runId: id };
const partIndex = z
  .int()
  .min(0)
  .max(Math.ceil(sadeProjectFileMaxBytes / sadeProjectChunkBytes) - 1);
export const sadeProjectArtifact = z.strictObject({
  id: digest,
  path: z.string().min(1).max(300),
  bytes: z.int().positive().max(sadeProjectFileMaxBytes),
  sha256: digest,
});
export const sadeProjectFile = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('catalogue'),
    ...transfer,
    projectKey: digest,
    data: z
      .string()
      .min(8)
      .max(Math.ceil(sadeProjectCatalogueMaxBytes / 3) * 4),
  }),
  z.strictObject({
    action: z.literal('upload'),
    ...transfer,
    jobId: id,
    path: z.string().min(1).max(300),
    bytes: sadeProjectArtifact.shape.bytes,
    sha256: digest,
    part: partIndex,
    data: z
      .string()
      .min(1)
      .max(Math.ceil(sadeProjectChunkBytes / 3) * 4),
  }),
  z.strictObject({
    action: z.literal('download'),
    ...transfer,
    jobId: id.optional(),
    fileId: digest,
    part: partIndex,
  }),
]);
export type SadeProjectFileCommand = z.infer<typeof sadeProjectFile>;
export type SadeCatalogue = {
  id: string;
  groupId: string;
  ownerId: string;
  projectKey: string;
  data: string;
  expiresAt: number;
};
export const sadeCatalogueKind = 'sharedSadeProjectCatalogue';
type FileRecord = SadeProjectArtifact & { runId: string; jobId: string; complete?: true };
type FilePart = { id: string; data: string };
const metadataKind = 'sharedSadeProjectArtifact';
const partKind = 'sharedSadeProjectArtifactPart';
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const fileKey = (jobId: string, path: string) => hash(jobId + '\0' + path);
const partKey = (fileId: string, part: number) => fileId + ':' + part;
const partCount = (bytes: number) => Math.ceil(bytes / sadeProjectChunkBytes);

export function validateCatalogue(source: string) {
  const image = Buffer.from(source, 'base64');
  if (
    image.length > sadeProjectCatalogueMaxBytes ||
    image.length < 4 ||
    image.toString('base64') !== source ||
    image.subarray(0, 3).toString('hex') !== 'ffd8ff' ||
    image.subarray(-2).toString('hex') !== 'ffd9'
  )
    throw new DomainError('Choose a valid JPEG catalogue image.', 400);
}

function validateOutput(path: string, data: Buffer) {
  if (path.endsWith('.pdf')) {
    if (
      !data.subarray(0, 8).toString().startsWith('%PDF-') ||
      !data.subarray(-2048).includes('%%EOF')
    )
      throw new DomainError('The exported PDF has an invalid header or trailer.', 400);
    return;
  }
  if (path.endsWith('.pptx')) {
    if (
      data.subarray(0, 4).toString('hex') !== '504b0304' ||
      !data.includes('[Content_Types].xml') ||
      !data.includes('ppt/presentation.xml') ||
      data.includes('vbaProject.bin')
    )
      throw new DomainError('Expected a PowerPoint package without macros.', 400);
    return;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new DomainError('The deliverable must be valid UTF-8 text.', 400);
  }
  if (
    !text.trim() ||
    text.includes('\0') ||
    privateKeyHeader.test(text) ||
    redact(text.slice(0, 20_000)) !== text.slice(0, 20_000)
  )
    throw new DomainError('The output is empty or appears to contain private credentials.', 400);
  if (path.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch {
      throw new DomainError('The exported JSON cannot be parsed.', 400);
    }
  }
  if (path.endsWith('.html') && !/<(?:!doctype\s+html|html|main|body|section|div)\b/i.test(text))
    throw new DomainError('The preview does not contain HTML.', 400);
}

export class SadeProjectFiles {
  constructor(private store: Store) {}

  publicFile(file: FileRecord): SadeProjectArtifact {
    const { id, path, bytes, sha256 } = file;
    return { id, path, bytes, sha256 };
  }

  outputs(runId: string, jobId: string, paths: string[]) {
    return paths.flatMap((path) => {
      const file = this.store.lookup<FileRecord>(metadataKind, fileKey(jobId, path));
      return file?.complete && file.runId === runId ? [this.publicFile(file)] : [];
    });
  }

  upload(input: Extract<SadeProjectFileCommand, { action: 'upload' }>) {
    const { path, bytes, sha256, jobId, runId, part, data } = input;
    const id = fileKey(jobId, path);
    const total = partCount(bytes);
    const chunk = Buffer.from(data, 'base64');
    const expectedBytes =
      part === total - 1 ? bytes - part * sadeProjectChunkBytes : sadeProjectChunkBytes;
    if (part >= total || chunk.length !== expectedBytes || chunk.toString('base64') !== data)
      throw new DomainError('Invalid deliverable transfer chunk.', 400);
    const existing = this.store.lookup<FileRecord>(metadataKind, id);
    if (
      existing &&
      (existing.sha256 !== sha256 || existing.bytes !== bytes || existing.runId !== runId)
    )
      throw new DomainError('This delivery already has an immutable output for that path.', 409);
    const previous = this.store.lookup<FilePart>(partKind, partKey(id, part));
    if (previous && previous.data !== data)
      throw new DomainError('A previously received chunk has different content.', 409);
    if (existing?.complete) return { complete: true, file: this.publicFile(existing) };
    const record: FileRecord = existing ?? { id, path, bytes, sha256, runId, jobId };
    if (!existing) this.store.put(metadataKind, record);
    if (!previous) this.store.put(partKind, { id: partKey(id, part), data });
    const parts = Array.from(
      { length: total },
      (_, index) => this.store.lookup<FilePart>(partKind, partKey(id, index))?.data,
    );
    if (parts.some((value) => !value)) return { complete: false };
    const built = Buffer.concat(parts.map((value) => Buffer.from(value!, 'base64')));
    if (built.length !== bytes || hash(built) !== sha256)
      throw new DomainError('Deliverable checksum did not match.', 400);
    validateOutput(path, built);
    this.store.put(metadataKind, { ...record, complete: true });
    return { complete: true, file: this.publicFile(record) };
  }

  read(input: Extract<SadeProjectFileCommand, { action: 'download' }>) {
    const file = this.store.lookup<FileRecord>(metadataKind, input.fileId);
    if (!file?.complete || file.runId !== input.runId)
      throw new DomainError('Deliverable unavailable.', 404);
    const part = this.store.lookup<FilePart>(partKind, partKey(file.id, input.part));
    if (!part) throw new DomainError('Deliverable chunk unavailable.', 404);
    return { data: part.data, file: this.publicFile(file) };
  }
}
