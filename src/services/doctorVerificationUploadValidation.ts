const MAX_BYTES = 1 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function extForMime(mime: string): string | null {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return null;
  }
}

export function safeFilename(name: string): string {
  // Strip path separators and control chars (avoid regex control ranges to satisfy eslint no-control-regex)
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '/' || ch === '\\') {
      out += '_';
      continue;
    }
    if (code < 0x20 || code === 0x7F) {
      continue;
    }
    out += ch;
    if (out.length >= 200) {
      break;
    }
  }
  return out || 'document';
}

export function validateDoctorVerificationUpload(file: { size: number; type: string }) {
  if (!file) {
    throw new Error('MISSING_FILE');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error('INVALID_MIME_TYPE');
  }
  const ext = extForMime(file.type);
  if (!ext) {
    throw new Error('INVALID_MIME_TYPE');
  }
  return { ext };
}
