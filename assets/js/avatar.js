/**
 * Avatar handling shared by onboarding and the profile page.
 *
 * One implementation so the two never drift: same square crop, same
 * compression, same bucket path, same error text.
 */

const AVATAR_PX = 800;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export const AVATAR_BUCKET = 'avatars';

/** Re-draws any image into a square, centred, compressed JPEG. */
export async function squareJpeg(file, size = AVATAR_PX) {
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not read that image.'))),
      'image/jpeg',
      0.9
    );
  });
}

/**
 * Uploads a photo for `userId` and writes avatar_url to their profile.
 * Returns the public URL. Throws messages meant to be shown to a human.
 */
export async function uploadAvatar(supabase, userId, file) {
  if (!file) throw new Error('No photo was selected.');

  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That photo is over 12 MB. Pick a smaller one.');
  }

  const blob = await squareJpeg(file);
  const path = `${userId}/avatar.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });

  if (uploadError) {
    // The bucket is created by the avatar_storage migration. Say that plainly
    // instead of leaking a storage error into the user's face.
    if (/bucket|not found/i.test(uploadError.message || '')) {
      throw new Error('Photo storage is not set up yet — run the avatar storage migration.');
    }
    throw uploadError;
  }

  const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;

  const { error: saveError } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);

  if (saveError) throw saveError;

  return avatarUrl;
}
