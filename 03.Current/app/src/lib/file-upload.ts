import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface UploadProgress {
  progress: number;
  state: 'running' | 'paused' | 'success' | 'error';
}

export function validateImageFile(file: File): ValidationResult {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPG, PNG, or WebP image.',
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: 'File is too large. Maximum size is 5MB.',
    };
  }

  return { valid: true };
}

export async function uploadProfilePhoto(
  storage: FirebaseStorage,
  userId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  // Validate the file first
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Generate a unique filename with timestamp
  const extension = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const fileName = `${timestamp}.${extension}`;
  const storagePath = `profile-photos/${userId}/${fileName}`;

  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        const state = snapshot.state === 'running' ? 'running' :
                      snapshot.state === 'paused' ? 'paused' : 'running';
        onProgress?.({ progress, state });
      },
      (error) => {
        onProgress?.({ progress: 0, state: 'error' });
        reject(new Error(`Upload failed: ${error.message}`));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.({ progress: 100, state: 'success' });
          resolve(downloadUrl);
        } catch (error: any) {
          reject(new Error(`Failed to get download URL: ${error.message}`));
        }
      }
    );
  });
}

export async function deleteProfilePhoto(
  storage: FirebaseStorage,
  photoUrl: string
): Promise<void> {
  try {
    // Extract the storage path from the URL
    const url = new URL(photoUrl);
    const pathMatch = url.pathname.match(/\/o\/(.+?)(\?|$)/);
    if (pathMatch) {
      const storagePath = decodeURIComponent(pathMatch[1]);
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
    }
  } catch (error) {
    // Silently fail - old photo might not exist or URL might be external
    console.warn('Could not delete old profile photo:', error);
  }
}

export async function compressImage(
  file: File,
  maxWidth: number = 400,
  quality: number = 0.8
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Could not compress image'));
            return;
          }

          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve(compressedFile);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => reject(new Error('Could not load image for compression'));

    // Read the file and set as image source
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
