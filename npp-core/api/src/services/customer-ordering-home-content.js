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

export function publicCustomerOrderingHomeContent(row, config) {
  const imagePresent = row?.banner_image_present === true;
  const version = Number(row?.banner_image_version ?? 0);
  return Object.freeze({
    sectionTitle: String(row?.section_title ?? DEFAULT_SECTION_TITLE),
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
  if (typeof payload?.visible !== 'boolean') {
    return { ok: false, code: 'INVALID_VISIBILITY', message: 'Trạng thái hiển thị không hợp lệ.' };
  }
  const row = await repository.saveCustomerOrderingHomeContent(client, {
    installationId,
    sectionTitle: title.value,
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
