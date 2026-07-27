'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import type {
  PriceAdjustmentType,
  PriceList,
  PriceListItem,
  PriceListType,
  PriceStackingMode,
  PricingCustomer,
  PricingCustomerGroup,
  PricingProduct,
  PricingResolution,
  PricingVariant,
  SalesChannel,
} from '../../lib/pricing-types';
import styles from './pricing.module.css';

type Tab = 'channels' | 'lists' | 'items' | 'resolver';

type ChannelForm = { code: string; name: string; description: string; isActive: boolean };
type ListForm = {
  code: string;
  name: string;
  listType: PriceListType;
  priority: string;
  stackingMode: PriceStackingMode;
  stopProcessing: boolean;
  channelId: string;
  customerGroupId: string;
  customerId: string;
  effectiveFrom: string;
  effectiveTo: string;
  description: string;
  isActive: boolean;
};
type ItemForm = {
  productId: string;
  variantId: string;
  adjustmentType: PriceAdjustmentType;
  amount: string;
  percent: string;
  minQuantity: string;
  maxQuantity: string;
  effectiveFrom: string;
  effectiveTo: string;
  externalRuleCode: string;
  note: string;
  isActive: boolean;
};

const EMPTY_CHANNEL: ChannelForm = { code: '', name: '', description: '', isActive: true };
const EMPTY_LIST: ListForm = {
  code: '', name: '', listType: 'BASE', priority: '100', stackingMode: 'EXCLUSIVE', stopProcessing: false,
  channelId: '', customerGroupId: '', customerId: '', effectiveFrom: '', effectiveTo: '', description: '', isActive: true,
};
const EMPTY_ITEM: ItemForm = {
  productId: '', variantId: '', adjustmentType: 'FIXED_PRICE', amount: '', percent: '',
  minQuantity: '0', maxQuantity: '', effectiveFrom: '', effectiveTo: '', externalRuleCode: '', note: '', isActive: true,
};

const LIST_LABELS: Record<PriceListType, string> = {
  BASE: 'Giá nền', CHANNEL: 'Theo kênh', CUSTOMER_GROUP: 'Theo nhóm khách', CUSTOMER: 'Theo khách hàng',
  PROMOTION: 'Khuyến mãi', CUSTOM: 'Quy tắc khác',
};
const ADJUSTMENT_LABELS: Record<PriceAdjustmentType, string> = {
  FIXED_PRICE: 'Đặt giá trực tiếp', PERCENT_DISCOUNT: 'Giảm phần trăm', AMOUNT_DISCOUNT: 'Giảm số tiền',
  PERCENT_MARKUP: 'Tăng phần trăm', AMOUNT_MARKUP: 'Tăng số tiền',
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; code?: string } };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function apiDate(value: string) {
  return value ? new Date(value).toISOString() : null;
}
function inputDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function percentToBps(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Phần trăm chỉ nhận tối đa 2 chữ số thập phân');
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}
function bpsToPercent(value: number | null) {
  if (value === null) return '';
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}
function money(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  try { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(BigInt(value)); }
  catch { return value; }
}
function adjustmentValue(item: PriceListItem) {
  return item.rate_bps === null ? money(item.amount_minor) : `${bpsToPercent(item.rate_bps)}%`;
}

export default function PricingWorkspace() {
  const [tab, setTab] = useState<Tab>('channels');
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [groups, setGroups] = useState<PricingCustomerGroup[]>([]);
  const [customers, setCustomers] = useState<PricingCustomer[]>([]);
  const [variants, setVariants] = useState<PricingVariant[]>([]);
  const [resolverVariants, setResolverVariants] = useState<PricingVariant[]>([]);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [channelForm, setChannelForm] = useState<ChannelForm>(EMPTY_CHANNEL);
  const [editingChannel, setEditingChannel] = useState<SalesChannel | null>(null);
  const [listForm, setListForm] = useState<ListForm>(EMPTY_LIST);
  const [editingList, setEditingList] = useState<PriceList | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [editingItem, setEditingItem] = useState<PriceListItem | null>(null);
  const [resolver, setResolver] = useState({ productId: '', variantId: '', quantity: '1', channelId: '', customerGroupId: '', customerId: '', manualPrice: '', manualReason: '' });
  const [resolution, setResolution] = useState<PricingResolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedList = lists.find((item) => item.id === selectedListId) ?? null;
  const usesAmount = ['FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP'].includes(itemForm.adjustmentType);

  async function loadCoreData() {
    const [nextChannels, nextLists, nextProducts, nextGroups, nextCustomers] = await Promise.all([
      requestJson<SalesChannel[]>('/api/sales-channels?limit=1000'),
      requestJson<PriceList[]>('/api/price-lists?limit=1000'),
      requestJson<PricingProduct[]>('/api/products?limit=1000'),
      requestJson<PricingCustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<PricingCustomer[]>('/api/customers?limit=1000'),
    ]);
    setChannels(nextChannels);
    setLists(nextLists);
    setProducts(nextProducts);
    setGroups(nextGroups);
    setCustomers(nextCustomers);
    if (!selectedListId && nextLists.length > 0) setSelectedListId(nextLists[0].id);
  }

  useEffect(() => {
    setBusy(true);
    loadCoreData().catch((error) => setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu giá'))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!selectedListId) { setItems([]); return; }
    requestJson<PriceListItem[]>(`/api/price-lists/${selectedListId}/items?limit=2000`)
      .then(setItems)
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Không thể tải quy tắc giá'));
  }, [selectedListId]);

  async function loadVariants(productId: string, target: 'item' | 'resolver') {
    if (target === 'item') { setItemForm((current) => ({ ...current, productId, variantId: '' })); setVariants([]); }
    else { setResolver((current) => ({ ...current, productId, variantId: '' })); setResolverVariants([]); }
    if (!productId) return;
    const next = await requestJson<PricingVariant[]>(`/api/products/${productId}/variants`);
    if (target === 'item') setVariants(next.filter((item) => item.is_active && item.is_sellable && item.unit_id && item.conversion_to_base));
    else setResolverVariants(next.filter((item) => item.is_active && item.is_sellable && item.unit_id && item.conversion_to_base));
  }

  function resetChannel() { setEditingChannel(null); setChannelForm(EMPTY_CHANNEL); }
  function editChannel(channel: SalesChannel) {
    setEditingChannel(channel);
    setChannelForm({ code: channel.code, name: channel.name, description: channel.description ?? '', isActive: channel.is_active });
  }
  async function saveChannel() {
    setBusy(true); setMessage(null);
    try {
      const body = { ...channelForm, ...(editingChannel ? { expectedUpdatedAt: editingChannel.updated_at } : {}) };
      const saved = editingChannel
        ? await requestJson<SalesChannel>(`/api/sales-channels/${editingChannel.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await requestJson<SalesChannel>('/api/sales-channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setChannels((current) => editingChannel ? current.map((row) => row.id === saved.id ? saved : row) : [...current, saved].sort((a, b) => a.code.localeCompare(b.code)));
      setMessage(editingChannel ? 'Đã cập nhật kênh bán' : 'Đã tạo kênh bán');
      resetChannel();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu kênh bán'); }
    finally { setBusy(false); }
  }
  async function toggleChannel(channel: SalesChannel) {
    setEditingChannel(channel);
    setChannelForm({ code: channel.code, name: channel.name, description: channel.description ?? '', isActive: !channel.is_active });
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<SalesChannel>(`/api/sales-channels/${channel.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: channel.name, description: channel.description, isActive: !channel.is_active, expectedUpdatedAt: channel.updated_at }),
      });
      setChannels((current) => current.map((row) => row.id === saved.id ? saved : row)); resetChannel();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái kênh'); }
    finally { setBusy(false); }
  }

  function resetList(type: PriceListType = 'BASE') {
    setEditingList(null);
    setListForm({ ...EMPTY_LIST, listType: type, priority: String({ BASE: 100, CHANNEL: 200, CUSTOMER_GROUP: 300, PROMOTION: 400, CUSTOMER: 500, CUSTOM: 600 }[type]) });
  }
  function editList(list: PriceList) {
    setEditingList(list);
    setListForm({
      code: list.code, name: list.name, listType: list.list_type, priority: String(list.priority), stackingMode: list.stacking_mode,
      stopProcessing: list.stop_processing, channelId: list.channel_id ?? '', customerGroupId: list.customer_group_id ?? '', customerId: list.customer_id ?? '',
      effectiveFrom: inputDate(list.effective_from), effectiveTo: inputDate(list.effective_to), description: list.description ?? '', isActive: list.is_active,
    });
  }
  async function saveList() {
    setBusy(true); setMessage(null);
    try {
      const body = {
        ...listForm, priority: Number(listForm.priority), channelId: listForm.channelId || null,
        customerGroupId: listForm.customerGroupId || null, customerId: listForm.customerId || null,
        effectiveFrom: apiDate(listForm.effectiveFrom), effectiveTo: apiDate(listForm.effectiveTo),
        ...(editingList ? { expectedUpdatedAt: editingList.updated_at } : {}),
      };
      const saved = editingList
        ? await requestJson<PriceList>(`/api/price-lists/${editingList.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await requestJson<PriceList>('/api/price-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setLists((current) => editingList ? current.map((row) => row.id === saved.id ? saved : row) : [...current, saved].sort((a, b) => b.priority - a.priority));
      setSelectedListId(saved.id); setMessage(editingList ? 'Đã cập nhật bảng giá/chương trình' : 'Đã tạo bảng giá/chương trình'); resetList(saved.list_type);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu bảng giá'); }
    finally { setBusy(false); }
  }
  async function toggleList(list: PriceList) {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<PriceList>(`/api/price-lists/${list.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !list.is_active, expectedUpdatedAt: list.updated_at }),
      });
      setLists((current) => current.map((row) => row.id === saved.id ? saved : row));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái bảng giá'); }
    finally { setBusy(false); }
  }

  function resetItem() { setEditingItem(null); setItemForm(EMPTY_ITEM); setVariants([]); }
  async function editItem(item: PriceListItem) {
    setEditingItem(item);
    setItemForm({
      productId: item.product_id, variantId: item.variant_id, adjustmentType: item.adjustment_type,
      amount: item.amount_minor ?? '', percent: bpsToPercent(item.rate_bps), minQuantity: item.min_quantity,
      maxQuantity: item.max_quantity ?? '', effectiveFrom: inputDate(item.effective_from), effectiveTo: inputDate(item.effective_to),
      externalRuleCode: item.external_rule_code ?? '', note: item.note ?? '', isActive: item.is_active,
    });
    const next = await requestJson<PricingVariant[]>(`/api/products/${item.product_id}/variants`);
    setVariants(next);
  }
  async function saveItem() {
    if (!selectedListId) { setMessage('Chọn bảng giá trước'); return; }
    setBusy(true); setMessage(null);
    try {
      const body = {
        variantId: itemForm.variantId,
        adjustmentType: itemForm.adjustmentType,
        amountMinor: usesAmount ? itemForm.amount : null,
        rateBps: usesAmount ? null : percentToBps(itemForm.percent),
        minQuantity: itemForm.minQuantity || '0', maxQuantity: itemForm.maxQuantity || null,
        effectiveFrom: apiDate(itemForm.effectiveFrom), effectiveTo: apiDate(itemForm.effectiveTo),
        externalRuleCode: itemForm.externalRuleCode || null, note: itemForm.note || null,
        sourceKind: 'ADMIN', isActive: itemForm.isActive,
        ...(editingItem ? { expectedUpdatedAt: editingItem.updated_at } : {}),
      };
      const saved = editingItem
        ? await requestJson<PriceListItem>(`/api/price-lists/${selectedListId}/items/${editingItem.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await requestJson<PriceListItem>(`/api/price-lists/${selectedListId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setItems((current) => editingItem ? current.map((row) => row.id === saved.id ? saved : row) : [...current, saved]);
      setMessage(editingItem ? 'Đã cập nhật quy tắc giá' : 'Đã thêm giá/quy tắc cho SKU'); resetItem();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu quy tắc giá'); }
    finally { setBusy(false); }
  }
  async function toggleItem(item: PriceListItem) {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<PriceListItem>(`/api/price-lists/${item.price_list_id}/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.is_active, expectedUpdatedAt: item.updated_at }),
      });
      setItems((current) => current.map((row) => row.id === saved.id ? saved : row));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái quy tắc'); }
    finally { setBusy(false); }
  }

  async function simulate() {
    setBusy(true); setMessage(null); setResolution(null);
    try {
      const result = await requestJson<PricingResolution>('/api/pricing/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          variantId: resolver.variantId, quantity: resolver.quantity || '1', channelId: resolver.channelId || null,
          customerGroupId: resolver.customerGroupId || null, customerId: resolver.customerId || null,
          manualUnitPriceMinor: resolver.manualPrice || null, manualReason: resolver.manualPrice ? resolver.manualReason : null,
        }),
      });
      setResolution(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể phân giải giá'); }
    finally { setBusy(false); }
  }

  const scopeDescription = useMemo(() => {
    if (listForm.listType === 'BASE') return 'Giá mặc định của đúng SKU; giá lẻ và thùng độc lập.';
    if (listForm.listType === 'CHANNEL') return 'Chọn một kênh bán.';
    if (listForm.listType === 'CUSTOMER_GROUP') return 'Chọn nhóm khách; có thể giới hạn thêm theo kênh.';
    if (listForm.listType === 'CUSTOMER') return 'Chọn khách cụ thể; có thể giới hạn thêm theo kênh.';
    return 'Có thể giới hạn theo kênh, nhóm khách hoặc khách cụ thể.';
  }, [listForm.listType]);

  return <AppShell title="Giá bán & khuyến mãi" subtitle="Giá nền theo SKU, giá kênh, nhóm khách, khách cụ thể và chương trình — hoàn toàn quản trị bằng dữ liệu.">
    <div className={styles.workspace} data-testid="pricing-page">
      <div className={styles.tabs} role="tablist">
        {([['channels', 'Kênh bán'], ['lists', 'Bảng giá & chương trình'], ['items', 'Giá theo SKU'], ['resolver', 'Thử giá']] as const).map(([value, label]) =>
          <button key={value} type="button" className={tab === value ? styles.tabActive : styles.tab} onClick={() => setTab(value)} data-testid={`pricing-${value}-tab`}>{label}</button>)}
      </div>
      {message ? <div className={styles.notice}>{message}</div> : null}

      {tab === 'channels' ? <section>
        <div className={styles.sectionHeader}><div><h2>Kênh bán</h2><p>Ví dụ: bán lẻ, quán/café, đại lý, online.</p></div><button className={styles.secondaryButton} type="button" onClick={resetChannel}>Tạo mới</button></div>
        <div className={styles.formPanel}>
          <div className={styles.formGrid}>
            <label>Mã<input disabled={Boolean(editingChannel)} value={channelForm.code} onChange={(e) => setChannelForm({ ...channelForm, code: e.target.value })} data-testid="channel-code-input" /></label>
            <label>Tên<input value={channelForm.name} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} data-testid="channel-name-input" /></label>
            <label className={styles.wide}>Mô tả<input value={channelForm.description} onChange={(e) => setChannelForm({ ...channelForm, description: e.target.value })} /></label>
          </div><label className={styles.check}><input type="checkbox" checked={channelForm.isActive} onChange={(e) => setChannelForm({ ...channelForm, isActive: e.target.checked })} /> Hoạt động</label>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void saveChannel()} data-testid="save-channel-button">{editingChannel ? 'Cập nhật kênh' : 'Tạo kênh'}</button>
        </div>
        <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {channels.map((channel) => <tr key={channel.id} data-testid={`channel-row-${channel.code}`}><td><strong>{channel.code}</strong></td><td>{channel.name}</td><td>{channel.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.actions}><button onClick={() => editChannel(channel)}>Sửa</button><button disabled={busy} onClick={() => void toggleChannel(channel)}>{channel.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td></tr>)}
          {channels.length === 0 ? <tr><td colSpan={4} className={styles.empty}>Chưa có kênh bán</td></tr> : null}
        </tbody></table></div>
      </section> : null}

      {tab === 'lists' ? <section>
        <div className={styles.sectionHeader}><div><h2>Bảng giá & chương trình</h2><p>Priority càng lớn càng được xét trước; giá không nằm trong code.</p></div><button className={styles.secondaryButton} type="button" onClick={() => resetList()}>Tạo mới</button></div>
        <div className={styles.formPanel}>
          <div className={styles.formGrid}>
            <label>Mã<input disabled={Boolean(editingList)} value={listForm.code} onChange={(e) => setListForm({ ...listForm, code: e.target.value })} data-testid="price-list-code-input" /></label>
            <label>Tên<input value={listForm.name} onChange={(e) => setListForm({ ...listForm, name: e.target.value })} data-testid="price-list-name-input" /></label>
            <label>Loại<select disabled={Boolean(editingList)} value={listForm.listType} onChange={(e) => resetList(e.target.value as PriceListType)} data-testid="price-list-type-select">{Object.entries(LIST_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Priority<input type="number" min="0" value={listForm.priority} onChange={(e) => setListForm({ ...listForm, priority: e.target.value })} data-testid="price-list-priority-input" /></label>
            <label>Xử lý<select value={listForm.stackingMode} onChange={(e) => setListForm({ ...listForm, stackingMode: e.target.value as PriceStackingMode })}><option value="EXCLUSIVE">Độc quyền</option><option value="STACKABLE">Được cộng dồn</option></select></label>
            <label>Kênh<select disabled={listForm.listType === 'BASE'} value={listForm.channelId} onChange={(e) => setListForm({ ...listForm, channelId: e.target.value })} data-testid="price-list-channel-select"><option value="">Tất cả/không áp dụng</option>{channels.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Nhóm khách<select disabled={['BASE', 'CHANNEL'].includes(listForm.listType)} value={listForm.customerGroupId} onChange={(e) => setListForm({ ...listForm, customerGroupId: e.target.value })}><option value="">Tất cả/không áp dụng</option>{groups.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Khách hàng<select disabled={!['CUSTOMER', 'PROMOTION', 'CUSTOM'].includes(listForm.listType)} value={listForm.customerId} onChange={(e) => setListForm({ ...listForm, customerId: e.target.value })}><option value="">Tất cả/không áp dụng</option>{customers.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Hiệu lực từ<input type="datetime-local" value={listForm.effectiveFrom} onChange={(e) => setListForm({ ...listForm, effectiveFrom: e.target.value })} /></label>
            <label>Hiệu lực đến<input type="datetime-local" value={listForm.effectiveTo} onChange={(e) => setListForm({ ...listForm, effectiveTo: e.target.value })} /></label>
            <label className={styles.wide}>Mô tả<input value={listForm.description} onChange={(e) => setListForm({ ...listForm, description: e.target.value })} /></label>
          </div><p className={styles.hint}>{scopeDescription}</p><div className={styles.checks}><label><input type="checkbox" checked={listForm.stopProcessing} onChange={(e) => setListForm({ ...listForm, stopProcessing: e.target.checked })} /> Dừng sau khi áp</label><label><input type="checkbox" checked={listForm.isActive} onChange={(e) => setListForm({ ...listForm, isActive: e.target.checked })} /> Hoạt động</label></div>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void saveList()} data-testid="save-price-list-button">{editingList ? 'Cập nhật bảng giá' : 'Tạo bảng giá'}</button>
        </div>
        <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Loại</th><th>Phạm vi</th><th>Priority</th><th>Xử lý</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {lists.map((list) => <tr key={list.id} data-testid={`price-list-row-${list.code}`}><td><strong>{list.code}</strong><br />{list.name}</td><td>{LIST_LABELS[list.list_type]}</td><td>{list.customer_name || list.customer_group_name || list.channel_name || 'Mặc định'}</td><td>{list.priority}</td><td>{list.stacking_mode === 'STACKABLE' ? 'Cộng dồn' : 'Độc quyền'}{list.stop_processing ? ' · Dừng' : ''}</td><td>{list.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.actions}><button onClick={() => editList(list)}>Sửa</button><button onClick={() => { setSelectedListId(list.id); setTab('items'); }}>Giá SKU</button><button disabled={busy} onClick={() => void toggleList(list)}>{list.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td></tr>)}
          {lists.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có bảng giá</td></tr> : null}
        </tbody></table></div>
      </section> : null}

      {tab === 'items' ? <section>
        <div className={styles.sectionHeader}><div><h2>Giá/quy tắc theo SKU</h2><p>Giá lẻ và giá thùng được nhập riêng trên đúng SKU.</p></div><button className={styles.secondaryButton} type="button" onClick={resetItem}>Tạo mới</button></div>
        <label className={styles.listPicker}>Bảng giá<select value={selectedListId} onChange={(e) => { setSelectedListId(e.target.value); resetItem(); }} data-testid="item-price-list-select"><option value="">Chọn bảng giá</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.code} — {list.name}</option>)}</select></label>
        {selectedList ? <div className={styles.formPanel}>
          <div className={styles.formGrid}>
            <label>Sản phẩm<select disabled={Boolean(editingItem)} value={itemForm.productId} onChange={(e) => void loadVariants(e.target.value, 'item')} data-testid="item-product-select"><option value="">Chọn sản phẩm</option>{products.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>SKU<select disabled={Boolean(editingItem) || !itemForm.productId} value={itemForm.variantId} onChange={(e) => setItemForm({ ...itemForm, variantId: e.target.value })} data-testid="item-variant-select"><option value="">Chọn SKU</option>{variants.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name}</option>)}</select></label>
            <label>Loại điều chỉnh<select disabled={Boolean(editingItem)} value={itemForm.adjustmentType} onChange={(e) => setItemForm({ ...itemForm, adjustmentType: e.target.value as PriceAdjustmentType })} data-testid="item-adjustment-select">{Object.entries(ADJUSTMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {usesAmount ? <label>Số tiền (₫)<input inputMode="numeric" value={itemForm.amount} onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value.replace(/\D/g, '') })} data-testid="item-amount-input" /></label> : <label>Phần trăm (%)<input inputMode="decimal" value={itemForm.percent} onChange={(e) => setItemForm({ ...itemForm, percent: e.target.value })} data-testid="item-percent-input" /></label>}
            <label>Số lượng từ<input value={itemForm.minQuantity} onChange={(e) => setItemForm({ ...itemForm, minQuantity: e.target.value })} /></label>
            <label>Số lượng đến<input value={itemForm.maxQuantity} onChange={(e) => setItemForm({ ...itemForm, maxQuantity: e.target.value })} placeholder="Không giới hạn" /></label>
            <label>Hiệu lực từ<input type="datetime-local" value={itemForm.effectiveFrom} onChange={(e) => setItemForm({ ...itemForm, effectiveFrom: e.target.value })} /></label>
            <label>Hiệu lực đến<input type="datetime-local" value={itemForm.effectiveTo} onChange={(e) => setItemForm({ ...itemForm, effectiveTo: e.target.value })} /></label>
            <label>Mã rule ngoài<input value={itemForm.externalRuleCode} onChange={(e) => setItemForm({ ...itemForm, externalRuleCode: e.target.value })} /></label>
            <label>Ghi chú<input value={itemForm.note} onChange={(e) => setItemForm({ ...itemForm, note: e.target.value })} /></label>
          </div><label className={styles.check}><input type="checkbox" checked={itemForm.isActive} onChange={(e) => setItemForm({ ...itemForm, isActive: e.target.checked })} /> Hoạt động</label>
          <button type="button" className={styles.primaryButton} disabled={busy || !itemForm.variantId} onClick={() => void saveItem()} data-testid="save-price-item-button">{editingItem ? 'Cập nhật quy tắc' : 'Thêm giá/quy tắc'}</button>
        </div> : <p className={styles.empty}>Chọn bảng giá để quản lý giá SKU.</p>}
        <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>SKU</th><th>Quy tắc</th><th>Giá trị</th><th>Bậc số lượng</th><th>Nguồn</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id} data-testid={`price-item-row-${item.sku}`}><td><strong>{item.sku}</strong><br />{item.product_name}</td><td>{ADJUSTMENT_LABELS[item.adjustment_type]}</td><td>{adjustmentValue(item)}</td><td>{item.min_quantity} → {item.max_quantity ?? '∞'}</td><td>{item.source_kind}{item.external_rule_code ? ` · ${item.external_rule_code}` : ''}</td><td>{item.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.actions}><button onClick={() => void editItem(item)}>Sửa</button><button disabled={busy} onClick={() => void toggleItem(item)}>{item.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button></td></tr>)}
          {items.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có giá/quy tắc trong bảng này</td></tr> : null}
        </tbody></table></div>
      </section> : null}

      {tab === 'resolver' ? <section>
        <div className={styles.sectionHeader}><div><h2>Thử giá & giải thích</h2><p>Chọn ngữ cảnh để xem giá nền, rule áp dụng, rule bị bỏ qua và giá cuối.</p></div></div>
        <div className={styles.formPanel}>
          <div className={styles.formGrid}>
            <label>Sản phẩm<select value={resolver.productId} onChange={(e) => void loadVariants(e.target.value, 'resolver')} data-testid="resolver-product-select"><option value="">Chọn sản phẩm</option>{products.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>SKU<select disabled={!resolver.productId} value={resolver.variantId} onChange={(e) => setResolver({ ...resolver, variantId: e.target.value })} data-testid="resolver-variant-select"><option value="">Chọn SKU</option>{resolverVariants.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name}</option>)}</select></label>
            <label>Số lượng<input value={resolver.quantity} onChange={(e) => setResolver({ ...resolver, quantity: e.target.value })} data-testid="resolver-quantity-input" /></label>
            <label>Kênh<select value={resolver.channelId} onChange={(e) => setResolver({ ...resolver, channelId: e.target.value })} data-testid="resolver-channel-select"><option value="">Không chọn</option>{channels.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Nhóm khách<select value={resolver.customerGroupId} onChange={(e) => setResolver({ ...resolver, customerGroupId: e.target.value })}><option value="">Tự suy ra/không chọn</option>{groups.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Khách hàng<select value={resolver.customerId} onChange={(e) => setResolver({ ...resolver, customerId: e.target.value })}><option value="">Không chọn</option>{customers.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label>
            <label>Giá chỉnh tay (₫)<input inputMode="numeric" value={resolver.manualPrice} onChange={(e) => setResolver({ ...resolver, manualPrice: e.target.value.replace(/\D/g, '') })} /></label>
            <label>Lý do chỉnh tay<input value={resolver.manualReason} onChange={(e) => setResolver({ ...resolver, manualReason: e.target.value })} /></label>
          </div><button type="button" className={styles.primaryButton} disabled={busy || !resolver.variantId} onClick={() => void simulate()} data-testid="resolve-price-button">Phân giải giá</button>
        </div>
        {resolution ? <div className={styles.result} data-testid="pricing-resolution">
          <div className={styles.resultGrid}><div><span>Giá nền</span><strong>{money(resolution.baseUnitPriceMinor)}</strong></div><div><span>Giá cuối</span><strong data-testid="resolved-unit-price">{money(resolution.finalUnitPriceMinor)}</strong></div><div><span>Thành tiền</span><strong data-testid="resolved-line-total">{money(resolution.lineTotalMinor)}</strong></div></div>
          <h3>Trace áp giá</h3><ol className={styles.trace}>{resolution.steps.map((step, index) => <li key={`${step.kind}-${step.itemId ?? index}`} data-testid={`pricing-step-${step.kind.toLowerCase()}`}><strong>{step.kind}</strong> {step.priceListCode ? `· ${step.priceListCode}` : ''} {step.adjustmentType ? `· ${ADJUSTMENT_LABELS[step.adjustmentType]}` : ''} {step.reason ? `· ${step.reason}` : ''}<span>{step.beforeUnitPriceMinor ? money(step.beforeUnitPriceMinor) : ''}{step.afterUnitPriceMinor ? ` → ${money(step.afterUnitPriceMinor)}` : ''}</span></li>)}</ol>
        </div> : null}
      </section> : null}
    </div>
  </AppShell>;
}
