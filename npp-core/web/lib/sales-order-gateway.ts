import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import type { ListSalesOrdersParams } from './sales-order-types';
import { requireNppWorkforceSessionToken } from './internal-auth-client';
import { recordSalesGatewayFailure, recordSlowSalesGatewayRequest } from './sales-order-gateway-diagnostics';
const REQUEST_ID_PATTERN=/^[A-Za-z0-9._:-]{1,128}$/;const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;const REQUEST_TIMEOUT_MS=30_000;const ALLOWED_QUERY_KEYS=new Set(['limit','offset','status','customerId','warehouseId','salesChannelId','pricingAt','search','source','lane','stage','scope','dateFrom','dateTo','beforeDate','cursorId','compact']);type CoreEnvelope<T>={data?:T;error?:{code?:string;message?:string;retryable?:boolean;details?:unknown};requestId?:string};export class SalesOrderGatewayError extends Error{constructor(public readonly code:string,public readonly publicMessage:string,public readonly statusCode:number,public readonly retryable:boolean,public readonly details:unknown={}){super(publicMessage);this.name='SalesOrderGatewayError';}}export function resolveSalesOrderRequestId(value:string|null|undefined){const c=String(value??'').trim();return REQUEST_ID_PATTERN.test(c)?c:`web_${randomUUID()}`;}export function normalizeSalesOrderGatewayError(error:unknown){return error instanceof SalesOrderGatewayError?error:new SalesOrderGatewayError('SALES_ORDER_GATEWAY_UNAVAILABLE','Chức năng bán hàng tạm thời chưa sẵn sàng',503,true);}function baseUrl(){const raw=process.env.CORE_API_INTERNAL_URL?.trim();if(!raw)throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED','Chức năng bán hàng chưa được cấu hình',503,false);let u:URL;try{u=new URL(raw);}catch{throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED','Chức năng bán hàng chưa được cấu hình',503,false);}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(process.env.NODE_ENV==='production'&&u.protocol!=='https:'))throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED','Chức năng bán hàng chưa được cấu hình',503,false);u.pathname=u.pathname.replace(/\/$/,'');u.search='';u.hash='';return u.toString().replace(/\/$/,'');}function uuid(v:string,c='INVALID_SALES_ORDER_ID',m='Mã đơn bán hàng không hợp lệ'){const n=String(v??'').trim();if(!UUID_PATTERN.test(n))throw new SalesOrderGatewayError(c,m,400,false);return n;}function version(v:string|number){const n=String(v??'').trim();if(!/^[1-9]\d{0,18}$/.test(n))throw new SalesOrderGatewayError('INVALID_SALES_ORDER_VERSION','Phiên bản đơn bán hàng không hợp lệ',400,false);return n;}function key(v:string|null|undefined){const n=normalizeIdempotencyKey(v);if(!n||!isValidIdempotencyKey(n))throw new SalesOrderGatewayError('INVALID_IDEMPOTENCY_KEY','Khóa chống trùng yêu cầu không hợp lệ',400,false);return n;}function path(id?:string){return `/api/sales-orders${id?`/${uuid(id)}`:''}`;}function safeQuery(p:URLSearchParams){const n=new URLSearchParams();for(const[k,v]of p.entries())if(ALLOWED_QUERY_KEYS.has(k)&&v.length<=256)n.append(k,v);const s=n.toString();return s?`?${s}`:'';}function searchContextUuid(sp:URLSearchParams,name:string,code:string,message:string){const raw=sp.get(name)?.trim()??'';return raw?uuid(raw,code,message):'';}function searchPricingAt(sp:URLSearchParams){const raw=sp.get('pricingAt')?.trim()??'';if(!raw)return '';const parsed=new Date(raw);if(Number.isNaN(parsed.getTime()))throw new SalesOrderGatewayError('INVALID_PRICING_AT','Thời điểm tính giá không hợp lệ',400,false);return parsed.toISOString();}async function req<T>({
  method,
  path: pth,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${pth}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch (error) {
      // An abort or broken body stream is transport failure (possibly timeout),
      // not invalid JSON. Let the outer handler classify it as 503/504.
      if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error;
      recordSalesGatewayFailure({
        requestId, method, path: pth, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      // An invalid response after POST can represent a successful commit with
      // a lost response. Clients must reconcile rather than assume failure.
      throw new SalesOrderGatewayError(
        'SALES_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi từ Công Ty không hợp lệ. Kiểm tra trạng thái đơn trước khi thử lại.',
        502,
        true,
      );
    }
    if (!payload || typeof payload !== 'object') {
      recordSalesGatewayFailure({
        requestId, method, path: pth, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      throw new SalesOrderGatewayError(
        'SALES_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi từ Công Ty không hợp lệ. Kiểm tra trạng thái đơn trước khi thử lại.',
        502, true,
      );
    }
    if (!response.ok) {
      if (response.status >= 500) {
        recordSalesGatewayFailure({
          requestId, method, path: pth, durationMs: Date.now() - startedAt,
          type: 'upstream_failure', statusCode: response.status,
        });
      }
      throw new SalesOrderGatewayError(
        payload.error?.code || 'SALES_ORDER_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu bán hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      recordSalesGatewayFailure({
        requestId, method, path: pth, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      throw new SalesOrderGatewayError(
        'SALES_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi từ Công Ty thiếu dữ liệu. Kiểm tra trạng thái đơn trước khi thử lại.',
        502,
        true,
      );
    }
    recordSlowSalesGatewayRequest({
      requestId, method, path: pth, durationMs: Date.now() - startedAt,
      statusCode: response.status,
    });
    return payload.data as T;
  } catch (error) {
    if (error instanceof SalesOrderGatewayError) throw error;
    const timedOut = controller.signal.aborted;
    recordSalesGatewayFailure({
      requestId, method, path: pth, durationMs: Date.now() - startedAt,
      type: timedOut ? 'timeout' : 'transport',
    });
    throw new SalesOrderGatewayError(
      timedOut ? 'SALES_ORDER_GATEWAY_TIMEOUT' : 'SALES_ORDER_GATEWAY_UNAVAILABLE',
      timedOut
        ? 'Công Ty phản hồi quá thời gian. Kiểm tra trạng thái đơn trước khi thử lại.'
        : 'Mất kết nối đến Công Ty. Kiểm tra trạng thái đơn trước khi thử lại.',
      timedOut ? 504 : 503,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
export function listSalesOrders<T>(requestId:string,params:ListSalesOrdersParams={}):Promise<T[]>{const q=new URLSearchParams();if(params.limit!==undefined)q.set('limit',String(Math.max(1,Math.min(1000,Math.trunc(params.limit)))));if(params.offset!==undefined)q.set('offset',String(Math.max(0,Math.trunc(params.offset))));if(params.status&&params.status!=='all')q.set('status',params.status);if(params.customerId)q.set('customerId',uuid(params.customerId,'INVALID_CUSTOMER_ID','Mã khách hàng không hợp lệ'));if(params.warehouseId)q.set('warehouseId',uuid(params.warehouseId,'INVALID_WAREHOUSE_ID','Mã kho không hợp lệ'));if(params.search?.trim())q.set('search',params.search.trim().slice(0,256));if(params.source)q.set('source',params.source);if(params.lane)q.set('lane',params.lane);if(params.stage)q.set('stage',params.stage);if(params.scope)q.set('scope',params.scope);if(params.dateFrom)q.set('dateFrom',params.dateFrom);if(params.dateTo)q.set('dateTo',params.dateTo);if(params.beforeDate)q.set('beforeDate',params.beforeDate);if(params.cursorId)q.set('cursorId',uuid(params.cursorId,'INVALID_ORDER_CURSOR','Trang danh sách đơn không hợp lệ'));if(params.compact)q.set('compact','1');return req<T[]>({method:'GET',path:path(),requestId,searchParams:q});}export function summarizeSalesOrders<T>(requestId:string,params:ListSalesOrdersParams={}):Promise<T>{const q=new URLSearchParams();if(params.search?.trim())q.set('search',params.search.trim().slice(0,256));if(params.source)q.set('source',params.source);if(params.lane)q.set('lane',params.lane);if(params.customerId)q.set('customerId',uuid(params.customerId));if(params.warehouseId)q.set('warehouseId',uuid(params.warehouseId));return req<T>({method:'GET',path:`${path()}/summary`,requestId,searchParams:q});}
export function getSalesOrderEntrySettings<T>(requestId:string):Promise<T>{return req<T>({method:'GET',path:`${path()}/entry-settings`,requestId});}export function updateSalesOrderEntrySettings<T>(r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'PUT',path:`${path()}/entry-settings`,requestId:r,body:b,idempotencyKey:key(k)});}export function searchSalesOrderSkus<T>(requestId:string,sp:URLSearchParams):Promise<T[]>{const q=new URLSearchParams();const s=sp.get('search')?.trim()??'';const l=Number(sp.get('limit')??20);const o=Number(sp.get('offset')??0);const warehouseId=searchContextUuid(sp,'warehouseId','INVALID_WAREHOUSE_ID','Mã kho không hợp lệ');const salesChannelId=searchContextUuid(sp,'salesChannelId','INVALID_SALES_CHANNEL_ID','Kênh bán không hợp lệ');const customerId=searchContextUuid(sp,'customerId','INVALID_CUSTOMER_ID','Mã khách hàng không hợp lệ');const pricingAt=searchPricingAt(sp);if(s)q.set('search',s.slice(0,256));q.set('limit',String(Number.isFinite(l)?Math.max(1,Math.min(50,Math.trunc(l))):20));q.set('offset',String(Number.isFinite(o)?Math.max(0,Math.trunc(o)):0));if(warehouseId)q.set('warehouseId',warehouseId);if(salesChannelId)q.set('salesChannelId',salesChannelId);if(customerId)q.set('customerId',customerId);if(pricingAt)q.set('pricingAt',pricingAt);return req<T[]>({method:'GET',path:`${path()}/sku-search`,requestId,searchParams:q});}export function getSalesOrder<T>(id:string,r:string):Promise<T>{return req<T>({method:'GET',path:path(id),requestId:r});}export function createSalesOrder<T>(r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:path(),requestId:r,body:b,idempotencyKey:key(k)});}export function updateSalesOrderDraft<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'PUT',path:`${path(id)}/draft`,requestId:r,body:b,idempotencyKey:key(k)});}export function confirmSalesOrder<T>(id:string,r:string,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/confirm`,requestId:r,body:{},idempotencyKey:key(k)});}export function createSalesOrderAmendment<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/amendments`,requestId:r,body:b,idempotencyKey:key(k)});}export function updateSalesOrderAmendment<T>(id:string,v:string|number,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'PUT',path:`${path(id)}/amendments/${version(v)}/draft`,requestId:r,body:b,idempotencyKey:key(k)});}export function confirmSalesOrderAmendment<T>(id:string,v:string|number,r:string,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/amendments/${version(v)}/confirm`,requestId:r,body:{},idempotencyKey:key(k)});}export function cancelSalesOrder<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/cancel`,requestId:r,body:b,idempotencyKey:key(k)});}
export function quickEditManualSalesOrder<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'PUT',path:`${path(id)}/manual-edit`,requestId:r,body:b,idempotencyKey:key(k)});}
export function issueManualSalesOrderStock<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/issue-stock`,requestId:r,body:b,idempotencyKey:key(k)});}
export function closeSalesOrderAfterExecution<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/close-execution`,requestId:r,body:b,idempotencyKey:key(k)});}
export function getManualSalesOrderReturn<T>(id:string,r:string):Promise<T>{return req<T>({method:'GET',path:`${path(id)}/manual-return`,requestId:r});}
export function receiveManualSalesOrderReturn<T>(id:string,r:string,b:unknown,k:string):Promise<T>{return req<T>({method:'POST',path:`${path(id)}/manual-return`,requestId:r,body:b,idempotencyKey:key(k)});}
