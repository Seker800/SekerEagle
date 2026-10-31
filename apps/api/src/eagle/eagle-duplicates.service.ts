import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type EagleAssetOperation, type EagleAssetOperationItem, type LibraryMode } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { findDuplicateGroups, type DuplicateCandidate, type DuplicateFingerprint, type DuplicateGroup } from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';
import { assetListInclude, serializeAssetList } from './eagle.service';
import { resolveEagleTrashTargets, setEagleTrash } from './eagle-trash';
import { DUPLICATE_FINGERPRINT_VERSION, fingerprintPreview } from './eagle-duplicate-fingerprint';
import type { DuplicateActionDto, DuplicateIgnoreDto, DuplicateListDto } from './eagle-duplicates.dto';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const BATCH = 16;
type Snapshot = {id: string; rowVersion: number; mediaRevision: number};
type CleanupSnapshot = {kind: 'cleanup'; resources: Snapshot[]; keepers: Snapshot[]; exact: boolean; targetId: string};
type ScanSnapshot = {kind: 'scan'; rows: Snapshot[]};
type Item = EagleAssetOperationItem & {operation: EagleAssetOperation};
const candidateSelect = {
  id: true, sha256: true, byteSize: true, mediaRevision: true, rowVersion: true, isPrivate: true,
  width: true, height: true, rating: true, libraryAddedAt: true, mimeType: true, lifecycleStatus: true,
  duplicateFingerprint: true,
} satisfies Prisma.EagleAssetSelect;
function signature(ownerId: string, mode: LibraryMode, group: DuplicateGroup, rows: Map<string, DuplicateCandidate>) {
  return digest([ownerId, mode, group.kind, group.assetIds.map(id => {
    const row = rows.get(id)!; return [id, row.mediaRevision, row.rowVersion];
  }).sort((a,b) => String(a[0]).localeCompare(String(b[0])))]);
}
@Injectable()
export class EagleDuplicateService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorageService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL') {}
  private scope(ownerId: string, includePrivate: boolean) {
    return {ownerId, libraryMode: this.libraryMode, deletedAt: null, purgeAfter: null, storageTransferredOut: false, ...(includePrivate ? {} : {isPrivate: false})};
  }
  private async read(tx: Prisma.TransactionClient, ownerId: string, includePrivate: boolean) {
    const [raw, dismissed] = await Promise.all([
      tx.eagleAsset.findMany({where: this.scope(ownerId, includePrivate), select: candidateSelect, orderBy: {id: 'asc'}}),
      tx.eagleDuplicateDismissal.findMany({where: {ownerId, libraryMode: this.libraryMode}, select: {signature: true}}),
    ]);
    const candidates: DuplicateCandidate[] = raw.map(row => ({...row, byteSize: Number(row.byteSize), libraryAddedAt: row.libraryAddedAt.toISOString(),
      fingerprint: row.duplicateFingerprint?.mediaRevision === row.mediaRevision && row.duplicateFingerprint.processorVersion === DUPLICATE_FINGERPRINT_VERSION
        ? {hash: row.duplicateFingerprint.hash, colors: row.duplicateFingerprint.colors as number[], contrast: row.duplicateFingerprint.contrast} : null}));
    const byId = new Map(candidates.map(row => [row.id, row])), ignored = new Set(dismissed.map(row => row.signature));
    const groups = findDuplicateGroups(candidates).map(group => ({...group, signature: signature(ownerId, this.libraryMode, group, byId)}));
    const revision = digest([ownerId, this.libraryMode, includePrivate, candidates.map(row => [row.id, row.mediaRevision, row.rowVersion, row.fingerprint?.hash]), dismissed.map(row => row.signature).sort()]);
    const images = raw.filter(row => row.mimeType.startsWith('image/'));
    return {raw, byId, groups, ignored, revision, coverage: {
      total: images.length, indexed: images.filter(row => byId.get(row.id)!.fingerprint).length,
      waiting: images.filter(row => row.lifecycleStatus !== 'READY').length,
    }};
  }
  async list(ownerId: string, includePrivate: boolean, input: DuplicateListDto) {
    return this.prisma.$transaction(async tx => {
      const state = await this.read(tx, ownerId, includePrivate);
      if (input.revision && input.revision !== state.revision) throw new ConflictException('图库已变化，请刷新查重结果。');
      const visible = state.groups.filter(group => (input.showIgnored === 'true' ? state.ignored.has(group.signature) : !state.ignored.has(group.signature)) && (!input.kind || input.kind === 'ALL' || input.kind === group.kind));
      const cursor = Number(input.cursor ?? 0);
      if (!Number.isSafeInteger(cursor)) throw new BadRequestException('分页位置无效。');
      const groups = visible.slice(cursor, cursor + 24);
      const previews = await tx.eagleAsset.findMany({where: {...this.scope(ownerId, includePrivate), id: {in: groups.flatMap(group => group.assetIds.slice(0,2))}}, include: assetListInclude});
      const previewById = new Map(previews.map(row => [row.id, serializeAssetList(row)]));
      return {revision: state.revision, coverage: state.coverage, totalGroups: visible.length,
        exactGroups: state.groups.filter(g => g.kind === 'EXACT' && !state.ignored.has(g.signature)).length,
        similarGroups: state.groups.filter(g => g.kind === 'SIMILAR' && !state.ignored.has(g.signature)).length,
        ignoredGroups: state.groups.filter(g => state.ignored.has(g.signature)).length,
        removableBytes: visible.reduce((n,g) => n + g.removableBytes, 0),
        nextCursor: cursor + groups.length < visible.length ? String(cursor + groups.length) : null,
        groups: groups.map(group => ({signature: group.signature, kind: group.kind, recommendedId: group.recommendedId, removableBytes: group.removableBytes, count: group.assetIds.length, previews: group.assetIds.slice(0,2).map(id => previewById.get(id)!)})),
      };
    }, {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000});
  }
  async members(ownerId: string, includePrivate: boolean, groupSignature: string, cursor = 0) {
    return this.prisma.$transaction(async tx => {
      const state = await this.read(tx, ownerId, includePrivate);
      const group = state.groups.find(row => row.signature === groupSignature);
      if (!group) throw new NotFoundException('这组结果已变化，请刷新后重试。');
      const ids = group.assetIds.slice(cursor, cursor + 24);
      const rows = await tx.eagleAsset.findMany({where: {...this.scope(ownerId, includePrivate), id: {in: ids}},
        include: {...assetListInclude, annotation: {select: {description: true, sourceUrl: true}}, editRecipe: {select: {baseAssetId: true}}}});
      const byId = new Map(rows.map(row => [row.id,row]));
      return {signature: group.signature, kind: group.kind, recommendedId: group.recommendedId, total: group.assetIds.length,
        nextCursor: cursor + ids.length < group.assetIds.length ? String(cursor + ids.length) : null,
        items: ids.map(id => {const row = byId.get(id)!; return {...serializeAssetList(row), annotation: row.annotation, editedCopy: !!row.editRecipe?.baseAssetId, livePhoto: !!row.livePhotoIdentifier};})};
    }, {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000});
  }
  async ignore(ownerId: string, includePrivate: boolean, input: DuplicateIgnoreDto) {
    return this.prisma.$transaction(async tx => {
      await lockOwnerPrivacyProjection(tx, ownerId, this.libraryMode);
      const state = await this.read(tx, ownerId, includePrivate);
      if (!state.groups.some(row => row.signature === input.signature)) throw new NotFoundException('查重组不存在。');
      const key = {ownerId, libraryMode: this.libraryMode, signature: input.signature};
      if (input.ignored) await tx.eagleDuplicateDismissal.upsert({where: {ownerId_libraryMode_signature: key}, create: key, update: {}});
      else await tx.eagleDuplicateDismissal.deleteMany({where: key});
      return {ignored: input.ignored};
    }, {timeout: 30_000});
  }
  private async existing(tx: Prisma.TransactionClient, principal: AuthPrincipal, id: string, kind: string, inputIds: string[]) {
    const existing = await tx.eagleAssetOperation.findUnique({where: {id}});
    if (!existing) return null;
    if (existing.ownerId !== principal.sub || existing.libraryMode !== this.libraryMode || (existing.isPrivate && !principal.canViewPrivate)) throw new NotFoundException('操作不存在。');
    if (existing.kind !== kind || JSON.stringify(existing.inputIds) !== JSON.stringify(inputIds)) throw new ConflictException('操作标识与选择不一致。');
    return {operationId: existing.id};
  }
  private async admit(tx: Prisma.TransactionClient, principal: AuthPrincipal, id: string, kind: string, inputIds: string[], isPrivate: boolean,
    items: Array<{assetIds: string[]; snapshots: ScanSnapshot | CleanupSnapshot; weight: number}>) {
    if (!items.length) return {operationId: null};
    const privateUntil = isPrivate && principal.privacyVisibleUntil ? new Date(principal.privacyVisibleUntil) : null;
    if (isPrivate && (!privateUntil || privateUntil <= new Date())) throw new NotFoundException('私密授权已失效。');
    await tx.eagleAssetOperation.create({data: {id, ownerId: principal.sub, libraryMode: this.libraryMode, kind, inputIds, authVersion: principal.authVersion, isPrivate, privateUntil}});
    for (let offset = 0; offset < items.length; offset += 500) await tx.eagleAssetOperationItem.createMany({data: items.slice(offset,offset+500).map((item,index) => ({...item, snapshots: item.snapshots as unknown as Prisma.InputJsonValue, id: randomUUID(), operationId: id, ownerId: principal.sub, libraryMode: this.libraryMode, ordinal: offset+index}))});
    return {operationId: id};
  }
  async scan(principal: AuthPrincipal, id: string) {
    return this.prisma.$transaction(async tx => {
      await lockOwnerPrivacyProjection(tx, principal.sub, this.libraryMode);
      const existing = await this.existing(tx, principal, id, 'DUPLICATE_SCAN', []);
      if (existing) return existing;
      const active = await tx.eagleAssetOperation.findFirst({where: {ownerId: principal.sub, libraryMode: this.libraryMode, kind: 'DUPLICATE_SCAN', isPrivate: principal.canViewPrivate, items: {some: {status: {in: ['PENDING','RUNNING']}}}}});
      if (active) return {operationId: active.id};
      const rows = await tx.eagleAsset.findMany({where: {...this.scope(principal.sub, principal.canViewPrivate), mimeType: {startsWith: 'image/'}, lifecycleStatus: 'READY'}, select: candidateSelect, orderBy: {id:'asc'}});
      const missing = rows.filter(row => row.duplicateFingerprint?.mediaRevision !== row.mediaRevision || row.duplicateFingerprint.processorVersion !== DUPLICATE_FINGERPRINT_VERSION);
      const items: Array<{assetIds: string[]; snapshots: ScanSnapshot; weight: number}> = [];
      for (let offset=0; offset<missing.length; offset+=BATCH) {const part=missing.slice(offset,offset+BATCH); items.push({assetIds: part.map(r=>r.id), snapshots: {kind:'scan',rows:part.map(({id,rowVersion,mediaRevision})=>({id,rowVersion,mediaRevision}))},weight:part.length});}
      return this.admit(tx, principal, id, 'DUPLICATE_SCAN', [], missing.some(r=>r.isPrivate), items);
    }, {timeout: 45_000});
  }
  async cleanup(principal: AuthPrincipal, input: DuplicateActionDto) {
    const request = [digest({allExact: input.allExact ?? false, revision: input.revision, groups: input.groups})];
    return this.prisma.$transaction(async tx => {
      await lockOwnerPrivacyProjection(tx, principal.sub, this.libraryMode);
      const existing = await this.existing(tx, principal, input.operationId, 'DUPLICATE_CLEANUP', request);
      if (existing) return existing;
      const state = await this.read(tx, principal.sub, principal.canViewPrivate);
      if (input.revision && state.revision !== input.revision) throw new ConflictException('图库已变化，请刷新后确认。');
      const choices = input.allExact ? state.groups.filter(g=>g.kind==='EXACT' && !state.ignored.has(g.signature)).map(g=>({signature:g.signature, keepIds:[g.recommendedId]})) : input.groups!;
      if (new Set(choices.map(c=>c.signature)).size !== choices.length) throw new BadRequestException('不能重复选择同一组。');
      const items: Array<{assetIds:string[]; snapshots:CleanupSnapshot;weight:number}> = [];
      let isPrivate = false;
      for (const choice of choices) {
        const group = state.groups.find(g=>g.signature===choice.signature);
        if (!group || state.ignored.has(choice.signature)) throw new NotFoundException('查重结果已变化。');
        const keep = new Set(choice.keepIds);
        if (!keep.size || keep.size!==choice.keepIds.length || [...keep].some(id=>!group.assetIds.includes(id))) throw new BadRequestException('每组必须保留至少一项，且只能保留本组内容。');
        const assetIds = group.assetIds.filter(id=>!keep.has(id));
        if (!assetIds.length) continue;
        // Resolve in bulk, including live-motion components, before freezing publication guards.
        const resources = await resolveEagleTrashTargets(tx, {ownerId:principal.sub,libraryMode:this.libraryMode}, assetIds, false, principal.canViewPrivate);
        const protectedResources = await resolveEagleTrashTargets(tx, {ownerId:principal.sub,libraryMode:this.libraryMode}, [...keep], false, principal.canViewPrivate);
        if (resources.some(row=>protectedResources.some(kept=>kept.id===row.id))) throw new ConflictException('这些项目属于同一实况照片，不能拆开清理。');
        isPrivate ||= group.assetIds.some(id=>state.byId.get(id)!.isPrivate);
        items.push({assetIds, snapshots:{kind:'cleanup', resources:resources.map(({id,rowVersion,mediaRevision})=>({id,rowVersion,mediaRevision})), keepers:protectedResources.map(({id,rowVersion,mediaRevision})=>({id,rowVersion,mediaRevision})), exact:group.kind==='EXACT', targetId:choice.keepIds[0]!},weight:assetIds.length});
      }
      return this.admit(tx,principal,input.operationId,'DUPLICATE_CLEANUP',request,isPrivate,items);
    }, {timeout: 45_000});
  }
  async execute(item: Item, assertActor: (tx: Prisma.TransactionClient) => Promise<void>) {
    if (item.operation.kind === 'DUPLICATE_SCAN') return this.executeScan(item, assertActor);
    const snapshot = item.snapshots as unknown as CleanupSnapshot;
    await this.prisma.$transaction(async tx => {
      await lockOwnerPrivacyProjection(tx,item.ownerId,this.libraryMode);
      await assertActor(tx);
      const expected = [...snapshot.resources,...snapshot.keepers], ids = expected.map(r=>r.id).sort();
      await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${item.ownerId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      const rows = await tx.eagleAsset.findMany({where:{...this.scope(item.ownerId,item.operation.isPrivate),id:{in:ids}},select:{id:true,rowVersion:true,mediaRevision:true,rating:true}});
      if (rows.length !== expected.length || expected.some(s=>!rows.some(r=>r.id===s.id && r.rowVersion===s.rowVersion && r.mediaRevision===s.mediaRevision))) throw new ConflictException('保留项或清理项已变化，请重新检查。');
      await resolveEagleTrashTargets(tx,{ownerId:item.ownerId,libraryMode:this.libraryMode},item.assetIds,false,item.operation.isPrivate,[{assetIds:item.assetIds,resourceIds:snapshot.resources.map(r=>r.id)}]);
      if (snapshot.exact) {
        const target=snapshot.targetId;
        const tags=await tx.eagleAssetManualTag.findMany({where:{ownerId:item.ownerId,libraryMode:this.libraryMode,assetId:{in:item.assetIds}},select:{tagId:true}});
        if(tags.length) await tx.eagleAssetManualTag.createMany({data:[...new Set(tags.map(t=>t.tagId))].map(tagId=>({ownerId:item.ownerId,libraryMode:this.libraryMode,assetId:target,tagId,assignedByUser:true,assignmentProvenance:'USER_ASSIGNED'})),skipDuplicates:true});
        await tx.eagleAsset.update({where:{id:target},data:{rating:Math.max(...rows.map(r=>r.rating??0))||null,rowVersion:{increment:1}}});
        await syncAssetPrivacy(tx,item.ownerId,[target],this.libraryMode);
      }
      await setEagleTrash(tx,{ownerId:item.ownerId,libraryMode:this.libraryMode},item.assetIds,false,item.operation.isPrivate);
      await assertActor(tx);
      await this.complete(tx,item);
    },{timeout:45_000});
  }
  private async complete(tx: Prisma.TransactionClient, item: Item) {
    const result=await tx.eagleAssetOperationItem.updateMany({where:{id:item.id,ownerId:item.ownerId,libraryMode:this.libraryMode,status:'RUNNING',leaseVersion:item.leaseVersion,leaseUntil:{gt:new Date()}},data:{status:'COMPLETED',leaseUntil:null}});
    if(result.count!==1) throw new ConflictException('操作租约已变化。');
  }
  private async executeScan(item: Item, assertActor: (tx:Prisma.TransactionClient)=>Promise<void>) {
    const snapshot=item.snapshots as unknown as ScanSnapshot;
    const rows=await this.prisma.eagleAsset.findMany({where:{...this.scope(item.ownerId,item.operation.isPrivate),id:{in:item.assetIds}},include:{duplicateFingerprint:true,renditions:{where:{status:'READY',kind:'THUMBNAIL'},orderBy:{byteSize:'asc'}}}});
    const results:Array<{id:string;mediaRevision:number;fingerprint:DuplicateFingerprint}>=[];
    // Two preview reads bound network buffers and decoder memory; the durable batch is never a product quota.
    for(let offset=0;offset<rows.length;offset+=2) await Promise.all(rows.slice(offset,offset+2).map(async row=>{
      const expected=snapshot.rows.find(r=>r.id===row.id);
      if(!expected || expected.mediaRevision!==row.mediaRevision) return;
      if(row.duplicateFingerprint?.mediaRevision===row.mediaRevision && row.duplicateFingerprint.processorVersion===DUPLICATE_FINGERPRINT_VERSION) return;
      const rendition=row.renditions.find(r=>r.revision===row.mediaRevision && r.mimeType.startsWith('image/'));
      if(!rendition) throw new ConflictException('缩略图尚未就绪，请稍后重试。');
      const signal=AbortSignal.timeout(10_000);
      const response=await this.storage.getObject(rendition.storageKey,{abortSignal:signal});
      const chunks:Buffer[]=[]; let bytes=0;
      const maxBytes=Number(process.env.EAGLE_DUPLICATE_PREVIEW_MAX_BYTES??2_097_152);
      if(!Number.isSafeInteger(maxBytes)||maxBytes<1) throw new Error('INVALID_DUPLICATE_PREVIEW_BUDGET');
      const body=response.Body as AsyncIterable<Uint8Array> & {destroy?:()=>void};
      try {for await(const chunk of body){bytes+=chunk.length;if(bytes>maxBytes)throw new Error('DUPLICATE_PREVIEW_TOO_LARGE');chunks.push(Buffer.from(chunk));}}
      finally {body.destroy?.();}
      results.push({id:row.id,mediaRevision:row.mediaRevision,fingerprint:await fingerprintPreview(Buffer.concat(chunks))});
    }));
    await this.prisma.$transaction(async tx=>{
      await lockOwnerPrivacyProjection(tx,item.ownerId,this.libraryMode);await assertActor(tx);
      for(const result of results){
        const current=await tx.eagleAsset.findFirst({where:{...this.scope(item.ownerId,item.operation.isPrivate),id:result.id,mediaRevision:result.mediaRevision},select:{id:true}});
        if(!current)continue;
        const data={ownerId:item.ownerId,libraryMode:this.libraryMode,mediaRevision:result.mediaRevision,processorVersion:DUPLICATE_FINGERPRINT_VERSION,...result.fingerprint};
        await tx.eagleDuplicateFingerprint.upsert({where:{assetId:result.id},create:{assetId:result.id,...data},update:data});
      }
      await assertActor(tx);await this.complete(tx,item);
    },{timeout:30_000});
  }
}
