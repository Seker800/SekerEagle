import type {EagleAssetListItem} from './eagle-api';
import {request} from './api-client';
import {libraryApiPath, type LibraryMode} from './library-api-scope';
export interface DuplicateGroupSummary {
 signature:string;kind:'EXACT'|'SIMILAR';recommendedId:string;count:number;removableBytes:number;previews:EagleAssetListItem[];
}
export interface DuplicateResults {
 revision:string;coverage:{total:number;indexed:number;waiting:number};totalGroups:number;exactGroups:number;similarGroups:number;ignoredGroups:number;removableBytes:number;nextCursor:string|null;groups:DuplicateGroupSummary[];
}
export interface DuplicateMembers {
 signature:string;kind:'EXACT'|'SIMILAR';recommendedId:string;total:number;nextCursor:string|null;
 items:Array<EagleAssetListItem & {annotation:{description:string|null;sourceUrl:string|null}|null;editedCopy:boolean;livePhoto:boolean}>;
}
export interface DuplicateCleanupInput {operationId:string;revision?:string;allExact?:boolean;groups?:Array<{signature:string;keepIds:string[]}>}
export function createDuplicatesApi(mode:LibraryMode){
 const base=libraryApiPath('/api/eagle/duplicates',mode);
 return {
  list:(query:{cursor?:string;revision?:string;kind?:string;showIgnored?:string},signal?:AbortSignal)=>request<DuplicateResults>(`${base}?${new URLSearchParams(query)}`,{signal}),
  members:(signature:string,cursor:string|undefined,signal?:AbortSignal)=>request<DuplicateMembers>(`${base}/${encodeURIComponent(signature)}/members?${new URLSearchParams(cursor?{cursor}:{})}`,{signal}),
  scan:(operationId:string)=>request<{operationId:string|null}>(`${base}/scan`,{method:'POST',body:JSON.stringify({operationId})}),
  cleanup:(input:DuplicateCleanupInput)=>request<{operationId:string|null}>(`${base}/cleanup`,{method:'POST',body:JSON.stringify(input)}),
  ignore:(signature:string,ignored:boolean)=>request<{ignored:boolean}>(`${base}/ignore`,{method:'POST',body:JSON.stringify({signature,ignored})}),
 };
}
