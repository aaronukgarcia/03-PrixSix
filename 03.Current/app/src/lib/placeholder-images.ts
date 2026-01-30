// GUID: LIB_PLACEHOLDER_IMAGES-000-v03
// [Intent] Provides typed access to driver placeholder image data loaded from a JSON file.
//          Acts as the bridge between the raw JSON image catalogue and the typed TypeScript codebase.
// [Inbound Trigger] Imported by data.ts (getDriverImage) and any component needing driver image URLs.
// [Downstream Impact] If the JSON structure or this module's exports change, driver images across the
//                     entire app (predictions, standings, scoring) will be affected.

import data from './placeholder-images.json';

// GUID: LIB_PLACEHOLDER_IMAGES-001-v03
// [Intent] Define the TypeScript shape for an image placeholder entry, ensuring type safety
//          when accessing image data throughout the application.
// [Inbound Trigger] Used by PlaceHolderImages array and any component that handles image data.
// [Downstream Impact] Changing this type requires updating all code that destructures ImagePlaceholder objects.
export type ImagePlaceholder = {
  id: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

// GUID: LIB_PLACEHOLDER_IMAGES-002-v03
// [Intent] Export the full array of placeholder images from the JSON catalogue, typed as ImagePlaceholder[].
//          This is the single source of truth for driver image URL lookups.
// [Inbound Trigger] Referenced by data.ts getDriverImage() to resolve driver imageId to actual URLs.
// [Downstream Impact] If the JSON file changes (new images, removed entries, changed URLs), all driver
//                     image displays across the app are affected. The data.ts fallback URL activates
//                     when a driver's imageId cannot be matched here.
export const PlaceHolderImages: ImagePlaceholder[] = data.placeholderImages;
