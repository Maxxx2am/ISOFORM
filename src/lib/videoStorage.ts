import * as FileSystem from 'expo-file-system/legacy';

const RECORDINGS_DIR = `${FileSystem.documentDirectory ?? ''}recordings/`;

async function ensureRecordingsDir() {
  if (!RECORDINGS_DIR) throw new Error('Document storage unavailable');
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
}

export async function persistBase64Video(base64: string, mime: string): Promise<string> {
  await ensureRecordingsDir();
  const ext = mime.includes('webm') ? 'webm' : 'mp4';
  const uri = `${RECORDINGS_DIR}set-${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

export async function persistVideoUri(sourceUri: string, mime = 'video/mp4'): Promise<string> {
  if (sourceUri.startsWith(RECORDINGS_DIR)) return sourceUri;
  await ensureRecordingsDir();
  const ext = mime.includes('webm') ? 'webm' : 'mp4';
  const destination = `${RECORDINGS_DIR}import-${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}
