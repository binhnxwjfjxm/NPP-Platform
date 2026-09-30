import * as repository from '../db/repositories/customer-ordering-home-content.js';
import { customerOrderingHomeBannerUrl } from '../storage/customer-ordering-home-banner.js';

const DEFAULT_SECTION_TITLE = 'Sự kiện';

function normalizeTitle(value) {
  const title = String(value ?? '').trim();
  if (!title || title.length > 80) {
    return { ok: false, code: 'INVALID_SECTION_TITLE', message: 'Tiêu đề phải có từ 1 đến 80 ký tự.' };
  }
  return { ok: true, value: title };
}

function normalizeProgramContent(value) {
  const content = String(value ?? '').trim();
  if (content.length > 4000) {
    return { ok: false, code: 'INVALID_PROGRAM_CONTENT', message: 'Nội dung chương trình không được vượt quá 4.000 ký tự.' };
  }
  return { ok: true, value: content };
}

export function publicCustomerOrderingHomeContent(row, config) {
  const imagePresent = row?.banner_image_present === true;
  const version = Number(row?.banner_image_version ?? 0);
  return Object.freeze({
    sectionTitle: String(row?.section_title ?? DEFAULT_SECTION_TITLE),
    programContent: String(row?.program_content ?? ''),
    visible: row?.is_visible === true,
    bannerUrl: imagePresent ? customerOrderingHomeBannerUrl(config, version) : null,
    imagePresent,
    updatedAt: row?.updated_at ?? null,
  });
}

export async function getCustomerOrderingHomeContent(client, {
  installationId,
  config,
}) {
  const row = await repository.getCustomerOrderingHomeContent(client, { installationId });
  return Object.freeze({ ok: true, content: publicCustomerOrderingHomeContent(row, config) });
}

export async function updateCustomerOrderingHomeContent(client, {
  installationId,
  config,
  payload,
  actorId,
}) {
  const title = normalizeTitle(payload?.sectionTitle);
  if (!title.ok) return title;
  const hasProgramContent = Object.prototype.hasOwnProperty.call(payload ?? {}, 'programContent');
  const programContent = hasProgramContent
    ? normalizeProgramContent(payload?.programContent)
    : { ok: true, value: null };
  if (!programContent.ok) return programContent;
  if (typeof payload?.visible !== 'boolean') {
    return { ok: false, code: 'INVALID_VISIBILITY', message: 'Trạng thái hiển thị không hợp lệ.' };
  }
  const row = await repository.saveCustomerOrderingHomeContent(client, {
    installationId,
    sectionTitle: title.value,
    programContent: programContent.value,
    isVisible: payload.visible,
    actorId,
  });
  return Object.freeze({
    ok: true,
    content: publicCustomerOrderingHomeContent(row, config),
    row,
  });
}

export async function markCustomerOrderingHomeBannerUploaded(client, {
  installationId,
  config,
  actorId,
}) {
  const row = await repository.markCustomerOrderingHomeBannerUploaded(client, {
    installationId,
    actorId,
  });
  return Object.freeze({
    ok: true,
    content: publicCustomerOrderingHomeContent(row, config),
    row,
  });
}
