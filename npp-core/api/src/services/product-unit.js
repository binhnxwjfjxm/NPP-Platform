import * as core from './product-unit-core.js';
import * as unitRepo from '../db/repositories/units.js';
import { activeDependentsConflict, staleVersionConflict } from './deactivate-conflict-contract.js';

export * from './product-unit-core.js';

const ACTIVE_UNIT_DEPENDENCY_MESSAGE = 'Cannot deactivate a unit used by active product variants';
const UNIT_UPDATE_CONFLICT_MESSAGE = 'Unit update conflict';

export function normalizeUnitConflictResult(result, activeAssignmentCount = 0) {
  if (!result || result.ok || result.code !== 'CONFLICT') return result;

  if (result.message === ACTIVE_UNIT_DEPENDENCY_MESSAGE) {
    const count = Number.isFinite(Number(activeAssignmentCount))
      ? Math.max(0, Math.trunc(Number(activeAssignmentCount)))
      : 0;
    return activeDependentsConflict({
      code: 'CONFLICT',
      message: `Không thể ngừng đơn vị tính vì đang có ${count} SKU hoạt động sử dụng đơn vị này. Hãy chuyển đơn vị hoặc ngừng các SKU liên quan trước rồi thử lại.`,
      reason: 'UNIT_HAS_ACTIVE_VARIANTS',
      dependentType: 'product_variant',
      dependentLabel: 'SKU đang sử dụng đơn vị',
      count,
      managementPath: '/products',
      action: 'reassign_or_deactivate_skus_first',
    });
  }

  if (result.message === UNIT_UPDATE_CONFLICT_MESSAGE) {
    return staleVersionConflict({
      code: 'CONFLICT',
      entityLabel: 'Đơn vị tính',
      managementPath: '/products',
    });
  }

  return result;
}

export async function updateUnit(client, input) {
  const result = await core.updateUnit(client, input);
  if (result?.ok || result?.code !== 'CONFLICT') return result;

  if (result.message === ACTIVE_UNIT_DEPENDENCY_MESSAGE) {
    const count = await unitRepo.countActiveVariantAssignments(client, {
      installationId: input.installationId,
      unitId: input.id,
    });
    return normalizeUnitConflictResult(result, count);
  }

  return normalizeUnitConflictResult(result);
}
