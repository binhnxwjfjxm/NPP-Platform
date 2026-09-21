import * as organizationRepo from '../db/repositories/employee-organization.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function code(value) {
  return text(value).toUpperCase();
}

function uuidOrNull(value) {
  const normalized = text(value);
  if (!normalized) return null;
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function validUpdatedAt(value) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateCodeAndName(payload) {
  const normalizedCode = code(payload?.code);
  const name = text(payload?.name);
  if (!CODE_PATTERN.test(normalizedCode)) {
    return { ok: false, code: 'INVALID_ORGANIZATION_CODE', message: 'Mã chỉ gồm chữ in hoa, số, dấu gạch ngang hoặc gạch dưới' };
  }
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_ORGANIZATION_NAME', message: 'Tên phải có từ 1 đến 256 ký tự' };
  }
  return { ok: true, normalizedCode, name };
}

function wouldCreateDepartmentCycle(departments, departmentId, proposedParentId) {
  if (!departmentId || !proposedParentId) return false;
  if (departmentId === proposedParentId) return true;
  const byId = new Map(departments.map((item) => [item.id, item]));
  let cursor = byId.get(proposedParentId) ?? null;
  const visited = new Set();
  while (cursor) {
    if (cursor.id === departmentId) return true;
    if (visited.has(cursor.id)) return true;
    visited.add(cursor.id);
    cursor = cursor.parent_department_id ? (byId.get(cursor.parent_department_id) ?? null) : null;
  }
  return false;
}

export async function listOrganizationCatalog(client, { installationId }) {
  const [departments, positions, managers] = await Promise.all([
    organizationRepo.listDepartments(client, { installationId }),
    organizationRepo.listPositions(client, { installationId }),
    organizationRepo.listManagerCandidates(client, { installationId }),
  ]);
  return { ok: true, catalog: { departments, positions, managers } };
}

async function saveDepartment(client, { installationId, payload, actorId }) {
  const validated = validateCodeAndName(payload);
  if (!validated.ok) return validated;
  const parentDepartmentId = uuidOrNull(payload?.parentDepartmentId);
  if (parentDepartmentId === undefined) {
    return { ok: false, code: 'INVALID_PARENT_DEPARTMENT', message: 'Phòng/Bộ phận cấp trên không hợp lệ' };
  }

  const [departments, positions] = await Promise.all([
    organizationRepo.listDepartments(client, { installationId }),
    organizationRepo.listPositions(client, { installationId }),
  ]);
  const duplicate = departments.find((item) => item.code === validated.normalizedCode && item.id !== text(payload?.id));
  if (duplicate) {
    return { ok: false, code: 'DEPARTMENT_CODE_EXISTS', message: 'Mã Phòng/Bộ phận đã tồn tại' };
  }

  if (parentDepartmentId) {
    const parent = departments.find((item) => item.id === parentDepartmentId) ?? null;
    if (!parent) return { ok: false, code: 'DEPARTMENT_PARENT_NOT_FOUND', message: 'Không tìm thấy Phòng/Bộ phận cấp trên' };
    if (!parent.is_active && payload?.isActive !== false) return { ok: false, code: 'DEPARTMENT_PARENT_INACTIVE', message: 'Phòng/Bộ phận cấp trên đang ngừng sử dụng' };
  }

  const id = text(payload?.id);
  if (!id) {
    const department = await organizationRepo.insertDepartment(client, {
      installationId,
      code: validated.normalizedCode,
      name: validated.name,
      parentDepartmentId,
      actorId,
    });
    if (!department) return { ok: false, code: 'DEPARTMENT_CODE_EXISTS', message: 'Mã Phòng/Bộ phận đã tồn tại' };
    return { ok: true, action: 'create', resourceType: 'hr-department', beforeData: null, afterData: department };
  }
  if (!UUID_PATTERN.test(id)) {
    return { ok: false, code: 'INVALID_DEPARTMENT_ID', message: 'Phòng/Bộ phận không hợp lệ' };
  }
  if (wouldCreateDepartmentCycle(departments, id, parentDepartmentId)) {
    return { ok: false, code: 'DEPARTMENT_HIERARCHY_CYCLE', message: 'Cơ cấu Phòng/Bộ phận không được tạo vòng lặp' };
  }

  const expectedUpdatedAt = validUpdatedAt(payload?.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'Thiếu phiên bản dữ liệu cần cập nhật' };
  }
  const existing = await organizationRepo.getDepartmentByIdForUpdate(client, { installationId, id });
  if (!existing) return { ok: false, code: 'DEPARTMENT_NOT_FOUND', message: 'Không tìm thấy Phòng/Bộ phận' };

  const isActive = typeof payload?.isActive === 'boolean' ? payload.isActive : existing.is_active;
  if (!isActive) {
    if (departments.some((item) => item.is_active && item.parent_department_id === id)) {
      return { ok: false, code: 'DEPARTMENT_HAS_ACTIVE_CHILDREN', message: 'Hãy ngừng sử dụng các Phòng/Bộ phận trực thuộc trước' };
    }
    if (positions.some((item) => item.is_active && item.department_id === id)) {
      return { ok: false, code: 'DEPARTMENT_HAS_ACTIVE_POSITIONS', message: 'Hãy ngừng sử dụng các Vị trí công việc thuộc Phòng/Bộ phận này trước' };
    }
  }
  const department = await organizationRepo.updateDepartment(client, {
    installationId,
    id,
    code: validated.normalizedCode,
    name: validated.name,
    parentDepartmentId,
    isActive,
    actorId,
    expectedUpdatedAt,
  });
  if (!department) return { ok: false, code: 'ORGANIZATION_CONFLICT', message: 'Dữ liệu đã thay đổi, vui lòng tải lại trước khi lưu' };
  return { ok: true, action: 'update', resourceType: 'hr-department', beforeData: existing, afterData: department };
}

async function savePosition(client, { installationId, payload, actorId }) {
  const validated = validateCodeAndName(payload);
  if (!validated.ok) return validated;
  const departmentId = uuidOrNull(payload?.departmentId);
  if (departmentId === undefined) {
    return { ok: false, code: 'INVALID_POSITION_DEPARTMENT', message: 'Phòng/Bộ phận của vị trí không hợp lệ' };
  }

  const [positions, departments] = await Promise.all([
    organizationRepo.listPositions(client, { installationId }),
    organizationRepo.listDepartments(client, { installationId }),
  ]);
  const duplicate = positions.find((item) => item.code === validated.normalizedCode && item.id !== text(payload?.id));
  if (duplicate) return { ok: false, code: 'POSITION_CODE_EXISTS', message: 'Mã Vị trí công việc đã tồn tại' };

  if (departmentId) {
    const department = departments.find((item) => item.id === departmentId) ?? null;
    if (!department) return { ok: false, code: 'POSITION_DEPARTMENT_NOT_FOUND', message: 'Không tìm thấy Phòng/Bộ phận của vị trí' };
    if (!department.is_active && payload?.isActive !== false) return { ok: false, code: 'POSITION_DEPARTMENT_INACTIVE', message: 'Phòng/Bộ phận của vị trí đang ngừng sử dụng' };
  }

  const id = text(payload?.id);
  if (!id) {
    const position = await organizationRepo.insertPosition(client, {
      installationId,
      code: validated.normalizedCode,
      name: validated.name,
      departmentId,
      actorId,
    });
    if (!position) return { ok: false, code: 'POSITION_CODE_EXISTS', message: 'Mã Vị trí công việc đã tồn tại' };
    return { ok: true, action: 'create', resourceType: 'hr-position', beforeData: null, afterData: position };
  }
  if (!UUID_PATTERN.test(id)) return { ok: false, code: 'INVALID_POSITION_ID', message: 'Vị trí công việc không hợp lệ' };

  const expectedUpdatedAt = validUpdatedAt(payload?.expectedUpdatedAt);
  if (!expectedUpdatedAt) return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'Thiếu phiên bản dữ liệu cần cập nhật' };
  const existing = await organizationRepo.getPositionByIdForUpdate(client, { installationId, id });
  if (!existing) return { ok: false, code: 'POSITION_NOT_FOUND', message: 'Không tìm thấy Vị trí công việc' };

  const isActive = typeof payload?.isActive === 'boolean' ? payload.isActive : existing.is_active;
  const position = await organizationRepo.updatePosition(client, {
    installationId,
    id,
    code: validated.normalizedCode,
    name: validated.name,
    departmentId,
    isActive,
    actorId,
    expectedUpdatedAt,
  });
  if (!position) return { ok: false, code: 'ORGANIZATION_CONFLICT', message: 'Dữ liệu đã thay đổi, vui lòng tải lại trước khi lưu' };
  return { ok: true, action: 'update', resourceType: 'hr-position', beforeData: existing, afterData: position };
}

export async function saveOrganizationResource(client, { installationId, payload, actorId }) {
  const resource = text(payload?.resource).toUpperCase();
  if (resource === 'DEPARTMENT') return saveDepartment(client, { installationId, payload, actorId });
  if (resource === 'POSITION') return savePosition(client, { installationId, payload, actorId });
  return { ok: false, code: 'INVALID_ORGANIZATION_RESOURCE', message: 'Loại dữ liệu cơ cấu tổ chức không hợp lệ' };
}
