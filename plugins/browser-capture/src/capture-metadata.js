const HASH_LIKE_NAME = /^[a-f0-9_-]{12,}$/i;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
]);

export function deriveDisplayName({ altText, imageUrl, pageTitle }) {
  const alt = cleanText(altText, 255);
  if (alt) return alt;
  const fileName = meaningfulFileName(imageUrl);
  if (fileName) return fileName;
  return cleanText(pageTitle, 255) || '未命名图片';
}

export function buildCaptureMetadata({ pageUrl, pageTitle, imageUrl, altText }) {
  const sanitizedPageUrl = sanitizePageUrl(pageUrl);
  const sanitizedImageUrl = sanitizeImageSourceUrl(imageUrl);
  return {
    displayName: deriveDisplayName({ altText, imageUrl, pageTitle }),
    pageTitle: cleanText(pageTitle, 1000),
    pageUrl: sanitizedPageUrl,
    imageUrl: sanitizedImageUrl,
    altText: cleanText(altText, 1000) || null,
  };
}

export function sanitizePageUrl(value) {
  return sanitizeHttpUrl(value, false);
}

export function sanitizeImageSourceUrl(value) {
  try {
    return sanitizeHttpUrl(value, true);
  } catch {
    return null;
  }
}

export function buildOriginalName({ imageUrl, displayName, mimeType }) {
  const extension = MIME_EXTENSIONS.get(mimeType);
  if (!extension) throw new Error(`不支持的图片类型：${mimeType || '未知'}`);
  const sourceName = fileNameFromUrl(imageUrl);
  if (sourceName && sourceName.toLocaleLowerCase('en-US').endsWith(extension)) {
    return safeFileName(sourceName, extension);
  }
  if (mimeType === 'image/jpeg' && sourceName?.toLocaleLowerCase('en-US').endsWith('.jpeg')) {
    return safeFileName(sourceName, '.jpeg');
  }
  return `${safeStem(displayName)}${extension}`;
}

export function resolveSupportedMimeType(contentType, imageUrl) {
  const normalized = String(contentType || '')
    .split(';', 1)[0]
    .trim()
    .toLocaleLowerCase('en-US');
  if (MIME_EXTENSIONS.has(normalized)) return normalized;
  if (normalized && !['application/octet-stream', 'binary/octet-stream'].includes(normalized)) {
    return null;
  }
  const name = fileNameFromUrl(imageUrl)?.toLocaleLowerCase('en-US') ?? '';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  for (const [mimeType, extension] of MIME_EXTENSIONS) {
    if (name.endsWith(extension)) return mimeType;
  }
  return null;
}

function meaningfulFileName(value) {
  const fileName = fileNameFromUrl(value);
  if (!fileName) return null;
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  if (!stem || HASH_LIKE_NAME.test(stem) || /^\d{8,}$/.test(stem)) return null;
  return cleanText(decodeURIComponentSafe(stem), 255) || null;
}

function fileNameFromUrl(value) {
  try {
    const url = new URL(value);
    return url.pathname.split('/').filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}

function sanitizeHttpUrl(value, stripQuery) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP(S) URL');
  url.username = '';
  url.password = '';
  url.hash = '';
  if (stripQuery) url.search = '';
  return url.toString();
}

function cleanText(value, maxLength) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeStem(value) {
  const clean = replaceUnsafeFileNameCharacters(cleanText(value, 200))
    .replace(/[. ]+$/g, '')
    .trim();
  return clean || '未命名图片';
}

function replaceUnsafeFileNameCharacters(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 || '\\/:*?"<>|'.includes(character)
        ? '-'
        : character;
    })
    .join('');
}

function safeFileName(value, extension) {
  const decoded = decodeURIComponentSafe(value);
  const stem = decoded.slice(0, -extension.length);
  return `${safeStem(stem)}${extension}`;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
