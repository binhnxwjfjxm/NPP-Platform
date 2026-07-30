export function normalizeProductStatusError(error, fallback = 'Không thể đổi trạng thái dữ liệu hàng hóa.') {
  const code = String(error?.code ?? '').trim();
  const message = String(error?.message ?? '').trim();
  const details = error?.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {};
  const dependency = details.dependency && typeof details.dependency === 'object' ? details.dependency : null;

  if (details.conflictType === 'active_dependents' && dependency) {
    const count = Number.isFinite(Number(dependency.count)) ? Math.max(0, Math.trunc(Number(dependency.count))) : 0;
    const label = String(dependency.label ?? 'Dữ liệu phụ thuộc đang hoạt động');
    return `${message || 'Không thể ngừng sử dụng vì còn dữ liệu phụ thuộc.'}${count > 0 ? ` ${label}: ${count}.` : ''} Hãy xử lý dữ liệu liên quan trước rồi thử lại.`;
  }

  if (details.conflictType === 'stale_version' || code === 'STALE_VERSION') {
    return 'Dữ liệu đã được cập nhật ở phiên khác. Hãy làm mới danh sách rồi thực hiện lại.';
  }

  if (/cannot deactivate a unit used by active product variants/i.test(message)) {
    return 'Không thể ngừng đơn vị tính vì vẫn còn SKU đang sử dụng. Hãy chuyển đơn vị hoặc ngừng các SKU liên quan trước rồi thử lại.';
  }
  if (/unit update conflict/i.test(message)) {
    return 'Đơn vị tính đã được cập nhật ở phiên khác. Hãy làm mới danh sách rồi thử lại.';
  }
  if (/product cannot remain orderable without an active sellable sku/i.test(message)) {
    return 'Không thể ngừng SKU cuối cùng khi sản phẩm vẫn đang cho phép đặt hàng. Hãy tắt “Cho phép đặt hàng” của sản phẩm trước.';
  }
  if (/cannot activate an sku under an inactive product/i.test(message)) {
    return 'Không thể đưa SKU vào sử dụng khi sản phẩm đang ngừng hoạt động. Hãy đưa sản phẩm vào sử dụng trước.';
  }
  if (/cannot create an active sku under an inactive product/i.test(message)) {
    return 'Không thể tạo SKU đang hoạt động dưới một sản phẩm đã ngừng. Hãy đưa sản phẩm vào sử dụng trước.';
  }

  return message || code || fallback;
}
