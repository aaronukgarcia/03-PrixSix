// GUID: LIB_FILE_UPLOAD-000-v03
// [Intent] Client-side file upload utility module for profile photo management. Provides image validation, upload with progress tracking to Firebase Storage, deletion of old photos, and client-side image compression using canvas.
// [Inbound Trigger] Called by profile photo UI components when users upload, replace, or delete their profile pictures.
// [Downstream Impact] Uploads files to Firebase Storage under profile-photos/{userId}/. The returned download URL is stored in the user's Firestore profile document. Compression reduces bandwidth and storage costs.

import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

// GUID: LIB_FILE_UPLOAD-001-v03
// [Intent] Constants defining the allowed image MIME types and maximum file size (5MB) for profile photo uploads.
// [Inbound Trigger] Referenced by validateImageFile to enforce upload constraints.
// [Downstream Impact] Changing ALLOWED_TYPES affects which file formats users can upload. Changing MAX_FILE_SIZE affects the maximum upload size. Both are enforced client-side only.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// GUID: LIB_FILE_UPLOAD-002-v03
// [Intent] Type definition for the result of file validation, indicating whether the file passes constraints and an optional error message if not.
// [Inbound Trigger] Returned by validateImageFile and consumed by uploadProfilePhoto and UI components.
// [Downstream Impact] Changes to this interface affect all callers of validateImageFile.
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// GUID: LIB_FILE_UPLOAD-003-v03
// [Intent] Type definition for upload progress state, providing a percentage (0-100) and a state indicator used to update the UI progress bar.
// [Inbound Trigger] Passed to the onProgress callback during uploadProfilePhoto execution.
// [Downstream Impact] UI components depend on this shape to render upload progress indicators.
export interface UploadProgress {
  progress: number;
  state: 'running' | 'paused' | 'success' | 'error';
}

// GUID: LIB_FILE_UPLOAD-004-v03
// [Intent] Validate a File object against allowed MIME types and maximum file size before attempting upload. Returns a ValidationResult indicating pass/fail with a user-friendly error message.
// [Inbound Trigger] Called by uploadProfilePhoto before starting the upload, and optionally by UI components for immediate feedback on file selection.
// [Downstream Impact] If validation fails, the upload is blocked and the error message is shown to the user. Depends on ALLOWED_TYPES and MAX_FILE_SIZE constants (LIB_FILE_UPLOAD-001).
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

// GUID: LIB_FILE_UPLOAD-005-v03
// [Intent] Upload a profile photo to Firebase Storage under profile-photos/{userId}/{timestamp}.{ext}, with real-time progress reporting via an optional callback. Validates the file first, then uses resumable upload for reliability.
// [Inbound Trigger] Called from the profile photo upload UI component when the user confirms their image selection.
// [Downstream Impact] On success, returns the Firebase Storage download URL which is then stored in the user's Firestore profile document. On failure, throws an error that the caller must handle. Depends on validateImageFile (LIB_FILE_UPLOAD-004) for pre-upload validation.
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

// GUID: LIB_FILE_UPLOAD-006-v03
// [Intent] Delete a profile photo from Firebase Storage by extracting the storage path from the download URL and calling deleteObject. Silently fails if the photo does not exist or the URL is external, as this is a best-effort cleanup.
// [Inbound Trigger] Called when a user uploads a new profile photo (to remove the old one) or explicitly deletes their photo.
// [Downstream Impact] Removes the file from Firebase Storage, freeing storage space. Silent failure means orphaned files may remain if deletion fails, but this does not affect application functionality.
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

// GUID: LIB_FILE_UPLOAD-007-v03
// [Intent] Compress an image file client-side by resizing it to a maximum width (default 400px) while maintaining aspect ratio, and re-encoding as JPEG at a configurable quality level (default 0.8). Uses HTML5 Canvas for image manipulation.
// [Inbound Trigger] Called by the profile photo upload flow before uploadProfilePhoto to reduce file size and standardise dimensions.
// [Downstream Impact] Returns a new File object with reduced size. The compressed file replaces the original in the upload pipeline. Runs entirely client-side using Canvas API; requires browser environment (not usable server-side).
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
