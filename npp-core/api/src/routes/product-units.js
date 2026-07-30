import { handleProductUnitRoutes as handleLegacyProductUnitRoutes } from './product-units-legacy.js';

const ACTIVE_DEPENDENCY_PATTERN = /đang có\s+(\d+)\s+SKU hoạt động sử dụng đơn vị này/i;
const STALE_VERSION_PATTERN = /Đơn vị tính đã được cập nhật bởi phiên khác/i;

export function enrichUnitErrorPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.error || typeof payload.error !== 'object') return payload;
  if (payload.error.code !== 'CONFLICT') return payload;

  const message = String(payload.error.message ?? '');
  const activeMatch = ACTIVE_DEPENDENCY_PATTERN.exec(message);
  if (activeMatch) {
    const count = Math.max(0, Number.parseInt(activeMatch[1], 10) || 0);
    return {
      ...payload,
      error: {
        ...payload.error,
        details: {
          conflictCode: 'ACTIVE_DEPENDENTS',
          conflictType: 'active_dependents',
          reason: 'UNIT_HAS_ACTIVE_VARIANTS',
          action: 'reassign_or_deactivate_skus_first',
          dependency: {
            entityType: 'product_variant',
            label: 'SKU đang sử dụng đơn vị',
            count,
            managementPath: '/products',
          },
        },
      },
    };
  }

  if (STALE_VERSION_PATTERN.test(message)) {
    return {
      ...payload,
      error: {
        ...payload.error,
        details: {
          conflictCode: 'STALE_VERSION',
          conflictType: 'stale_version',
          reason: 'EXPECTED_UPDATED_AT_MISMATCH',
          action: 'refresh_and_retry',
          managementPath: '/products',
        },
      },
    };
  }

  return payload;
}

function responseProxy(res) {
  return new Proxy(res, {
    get(target, property) {
      if (property === 'end') {
        return (chunk, ...args) => {
          if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) return target.end(chunk, ...args);
          try {
            const payload = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
            return target.end(JSON.stringify(enrichUnitErrorPayload(payload)), ...args);
          } catch {
            return target.end(chunk, ...args);
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

export async function handleProductUnitRoutes(req, res, options) {
  return handleLegacyProductUnitRoutes(req, responseProxy(res), options);
}
