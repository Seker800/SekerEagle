import { isCameraRawMime } from '@sekereagle/library-core';
/** Cached pixels are for browsing; original dimensions and RAW editing keep separate provenance. */
export function cachedPhotoPolicy(mime: string, asset: {width?:number|null;height?:number|null}, tags: Record<string,unknown>, preview: {width:number;height:number}) {
 if(!mime.startsWith('image/')) throw new Error('CACHE_PHOTO_ONLY');
 let width=asset.width, height=asset.height;
 if(!width||!height){
  width=Number(tags.ImageWidth??tags.ExifImageWidth);height=Number(tags.ImageHeight??tags.ExifImageHeight);
  if([5,6,7,8].includes(Number(tags.Orientation)) || Math.abs(Number(tags.Rotation))%180===90) [width,height]=[height,width];
 }
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!width||!height||width<1||height<1||Math.abs((preview.width/preview.height)/(width/height)-1)>0.02) throw new Error('SOURCE_CACHE_ASPECT');
 return {width,height,deferRawEditing:isCameraRawMime(mime)};
}
