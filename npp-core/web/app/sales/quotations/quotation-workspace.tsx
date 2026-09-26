'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import type { Category, Channel, Customer, CustomerGroup, OfficialRows, Product, Variant } from '../../operations/data-exchange/data-exchange-model';
import { exactQuantity, exportTable, idempotency, requestJson } from '../../operations/data-exchange/data-exchange-file-utils';
import styles from './quotation-workspace.module.css';

type Scope = 'all' | 'category' | 'sku';
type BusyAction = 'build' | 'xlsx' | 'csv' | null;
type QuotationRow = {
  sku: string; name: string; product: string; quantity: string;
  finalPrice: string; lineTotal: string; priceListCode: string; currency: string;
};

const PRODUCT_PAGE_SIZE = 1000;
const MAX_PRODUCT_OFFSET = 10000;
const VARIANT_BATCH_SIZE = 500;
const MAX_QUOTATION_SKUS = 1000;
const EXPORT_HEADERS = ['Mã hàng', 'Sản phẩm', 'Quy cách', 'Số lượng', 'Tiền tệ', 'Đơn giá', 'Thành tiền', 'Nguồn giá'];

async function loadAllProducts() {
  const rows: Product[] = [];
  for (let offset = 0; offset <= MAX_PRODUCT_OFFSET; offset += PRODUCT_PAGE_SIZE) {
    const page = await requestJson<Product[]>('/api/products?active=true&limit=' + PRODUCT_PAGE_SIZE + '&offset=' + offset);
    rows.push(...page);
    if (page.length < PRODUCT_PAGE_SIZE) return rows;
  }
  throw new Error('Danh mục sản phẩm quá lớn để tải toàn bộ trong một lần. Hãy thu hẹp phạm vi báo giá.');
}

async function loadVariantsForProducts(productIds: string[]) {
  const rows: Variant[] = [];
  for (let index = 0; index < productIds.length; index += VARIANT_BATCH_SIZE) {
    const batch = productIds.slice(index, index + VARIANT_BATCH_SIZE);
    const variants = await requestJson<Variant[]>('/api/products/variants/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: batch }),
    });
    rows.push(...variants);
  }
  return rows;
}

function splitSkuInput(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function formatMoney(value: string, currency = 'VND') {
  if (!value) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(numeric);
  } catch {
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(numeric);
  }
}

function safeFilePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export default function QuotationWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [scope, setScope] = useState<Scope>('all');
  const [categoryId, setCategoryId] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [channelId, setChannelId] = useState('');
  const [customerGroupId, setCustomerGroupId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingReferences(true);
    Promise.all([
      loadAllProducts(),
      requestJson<Category[]>('/api/product-categories?limit=1000'),
      requestJson<Channel[]>('/api/sales-channels?limit=1000'),
      requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<Customer[]>('/api/customers?limit=1000'),
    ]).then(([nextProducts, nextCategories, nextChannels, nextGroups, nextCustomers]) => {
      if (cancelled) return;
      setProducts(nextProducts); setCategories(nextCategories); setChannels(nextChannels); setGroups(nextGroups); setCustomers(nextCustomers); setError('');
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu để lập báo giá.');
    }).finally(() => {
      if (!cancelled) setLoadingReferences(false);
    });
    return () => { cancelled = true; };
  }, []);

  const selectedCustomer = useMemo(() => customers.find((item) => item.id === customerId) ?? null, [customers, customerId]);
  const selectedCategory = useMemo(() => categories.find((item) => item.id === categoryId) ?? null, [categories, categoryId]);
  const filteredCustomers = useMemo(() => {
    const term = customerQuery.trim().toLocaleLowerCase('vi-VN');
    const matches = customers
      .filter((item) => item.is_active)
      .filter((item) => !term || item.code.toLocaleLowerCase('vi-VN').includes(term) || item.name.toLocaleLowerCase('vi-VN').includes(term))
      .slice(0, 80);
    if (selectedCustomer && !matches.some((item) => item.id === selectedCustomer.id)) return [selectedCustomer, ...matches].slice(0, 80);
    return matches;
  }, [customers, customerQuery, selectedCustomer]);

  const pricedCount = rows.filter((row) => row.finalPrice !== '').length;
  const totalValue = rows.reduce((sum, row) => {
    const value = Number(row.lineTotal);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const manualSkuCount = splitSkuInput(skuInput).length;

  function invalidateResult() {
    operationKeyRef.current = null;
    setRows([]); setError(''); setMessage('');
  }

  function changeScope(next: Scope) {
    invalidateResult();
    setScope(next);
  }

  function changeCustomer(nextId: string) {
    invalidateResult();
    setCustomerId(nextId);
    const customer = customers.find((item) => item.id === nextId);
    setCustomerGroupId(customer?.group_id ?? '');
  }

  async function buildQuotation() {
    if (loadingReferences || busy) return;
    setBusy('build'); setError(''); setMessage('');
    try {
      const normalizedQuantity = exactQuantity(quantity, 'quantity', 6);
      if (/^0(?:\.0+)?$/.test(normalizedQuantity)) throw new Error('Số lượng phải lớn hơn 0.');
      const activeProducts = products.filter((product) => product.is_active && product.is_orderable);
      let selectedProducts = activeProducts;
      if (scope === 'category') {
        if (!categoryId) throw new Error('Chọn ngành hoặc nhóm sản phẩm cần báo giá.');
        selectedProducts = activeProducts.filter((product) => product.category_id === categoryId);
      }
      const requestedSkus = new Set(splitSkuInput(skuInput));
      if (scope === 'sku' && requestedSkus.size === 0) throw new Error('Nhập ít nhất một mã hàng cần báo giá.');
      if (!selectedProducts.length) throw new Error('Không có sản phẩm đang bán phù hợp với phạm vi đã chọn.');

      const variants = await loadVariantsForProducts(selectedProducts.map((product) => product.id));
      const skus = [...new Set(
        variants.filter((variant) => variant.is_active && variant.is_sellable)
          .filter((variant) => scope !== 'sku' || requestedSkus.has(variant.sku.toUpperCase()))
          .map((variant) => variant.sku),
      )].sort();

      if (scope === 'sku') {
        const found = new Set(skus.map((sku) => sku.toUpperCase()));
        const missing = [...requestedSkus].filter((sku) => !found.has(sku));
        if (missing.length) throw new Error('Không tìm thấy mã hàng đang bán: ' + missing.join(', ') + '.');
      }
      if (!skus.length) throw new Error('Không có mã hàng phù hợp để lập báo giá.');
      if (skus.length > MAX_QUOTATION_SKUS) {
        throw new Error('Phạm vi hiện có ' + skus.length.toLocaleString('vi-VN') + ' mã hàng. Mỗi báo giá tối đa 1.000 mã hàng; hãy chọn nhóm sản phẩm hoặc danh sách mã hàng cụ thể.');
      }

      const operationKey = operationKeyRef.current ?? idempotency('sales-quotation');
      operationKeyRef.current = operationKey;
      const result = await requestJson<OfficialRows>('/api/file-operations/quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({
          skus,
          quantity: normalizedQuantity,
          currencyCode: 'VND',
          channelId: channelId || null,
          customerGroupId: customerGroupId || null,
          customerId: customerId || null,
          format: 'tabular',
        }),
      });
      const nextRows = result.rows.map((row) => ({
        sku: String(row.sku ?? ''),
        name: String(row.skuName ?? ''),
        product: String(row.productName ?? ''),
        quantity: String(row.quantity ?? normalizedQuantity),
        finalPrice: String(row.unitPriceMinor ?? ''),
        lineTotal: String(row.lineTotalMinor ?? ''),
        priceListCode: String(row.priceListCode ?? ''),
        currency: String(row.currencyCode ?? 'VND'),
      }));
      setRows(nextRows);
      operationKeyRef.current = null;
      setMessage('Đã tính báo giá cho ' + nextRows.length.toLocaleString('vi-VN') + ' mã hàng.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tính được báo giá.');
    } finally {
      setBusy(null);
    }
  }

  async function exportQuotation(format: 'xlsx' | 'csv') {
    if (!rows.length || busy) return;
    setBusy(format); setError(''); setMessage('');
    try {
      const customerPart = selectedCustomer ? safeFilePart(selectedCustomer.code) : '';
      const filename = 'bao-gia' + (customerPart ? '-' + customerPart : '') + '.xlsx';
      await exportTable(filename, 'Báo giá', EXPORT_HEADERS, rows.map((row) => [
        row.sku, row.product, row.name, row.quantity, row.currency, row.finalPrice, row.lineTotal, row.priceListCode,
      ]), format);
      setMessage('Đã xuất ' + rows.length.toLocaleString('vi-VN') + ' dòng báo giá ra ' + (format === 'xlsx' ? 'Excel' : 'CSV') + '.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được báo giá.');
    } finally {
      setBusy(null);
    }
  }

  let scopeDescription = 'Toàn bộ mã hàng đang bán';
  if (scope === 'category') scopeDescription = selectedCategory ? selectedCategory.code + ' · ' + selectedCategory.name : 'Chưa chọn nhóm sản phẩm';
  if (scope === 'sku') scopeDescription = manualSkuCount ? manualSkuCount.toLocaleString('vi-VN') + ' mã hàng đã nhập' : 'Chưa nhập mã hàng';

  return (
    <AppShell kicker="Bán hàng" title="Báo giá" subtitle="Chọn khách hàng, phạm vi hàng hóa và điều kiện bán; hệ thống tính đúng mức giá đang có hiệu lực." actions={<Link className={styles.headerLink} href="/sales/sales-orders">Đơn bán hàng</Link>}>
      <div className={styles.page} data-testid="sales-quotation-workspace">
        {error ? <div className={styles.error} role="alert"><strong>Chưa thể thực hiện.</strong><span>{error}</span></div> : null}
        {message ? <div className={styles.success} role="status">{message}</div> : null}

        <div className={styles.setupGrid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}><span className={styles.step}>1</span><div><h2>Khách hàng và điều kiện bán</h2><p>Có thể để trống khách hàng để xem mức giá chung đang áp dụng.</p></div></div>
            <div className={styles.formGrid}>
              <label className={styles.span2 + ' ' + styles.field}><span>Tìm khách hàng</span><input type="search" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nhập mã hoặc tên khách hàng" autoComplete="off" /></label>
              <label className={styles.span2 + ' ' + styles.field}>
                <span>Khách hàng</span>
                <select value={customerId} onChange={(event) => changeCustomer(event.target.value)}>
                  <option value="">Khách chung / chưa chọn khách cụ thể</option>
                  {filteredCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
                </select>
                {customerQuery.trim() && filteredCustomers.length === 80 ? <small>Đang hiển thị 80 kết quả. Gõ thêm để thu hẹp.</small> : null}
              </label>
              <label className={styles.field}><span>Kênh bán</span><select value={channelId} onChange={(event) => { invalidateResult(); setChannelId(event.target.value); }}><option value="">Không chọn kênh</option>{channels.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
              <label className={styles.field}>
                <span>Nhóm khách</span>
                <select value={customerGroupId} disabled={Boolean(customerId)} onChange={(event) => { invalidateResult(); setCustomerGroupId(event.target.value); }}>
                  <option value="">Không chọn nhóm</option>
                  {groups.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
                {customerId ? <small>Tự lấy theo hồ sơ khách hàng đã chọn.</small> : null}
              </label>
              <label className={styles.field}><span>Số lượng áp dụng cho mỗi mã hàng</span><input inputMode="decimal" value={quantity} onChange={(event) => { invalidateResult(); setQuantity(event.target.value); }} /></label>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}><span className={styles.step}>2</span><div><h2>Hàng hóa cần báo giá</h2><p>Chọn phạm vi đủ hẹp để báo giá dễ kiểm tra và gửi cho khách.</p></div></div>
            <div className={styles.scopeSwitch} role="group" aria-label="Phạm vi hàng hóa">
              <button type="button" className={scope === 'all' ? styles.scopeActive : ''} aria-pressed={scope === 'all'} onClick={() => changeScope('all')}>Tất cả</button>
              <button type="button" className={scope === 'category' ? styles.scopeActive : ''} aria-pressed={scope === 'category'} onClick={() => changeScope('category')}>Theo nhóm</button>
              <button type="button" className={scope === 'sku' ? styles.scopeActive : ''} aria-pressed={scope === 'sku'} onClick={() => changeScope('sku')}>Theo mã hàng</button>
            </div>
            {scope === 'category' ? <label className={styles.field}><span>Ngành hoặc nhóm sản phẩm</span><select value={categoryId} onChange={(event) => { invalidateResult(); setCategoryId(event.target.value); }}><option value="">Chọn nhóm sản phẩm</option>{categories.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label> : null}
            {scope === 'sku' ? <label className={styles.field}><span>Mã hàng cần báo giá</span><textarea rows={6} value={skuInput} onChange={(event) => { invalidateResult(); setSkuInput(event.target.value); }} placeholder={'Mỗi mã một dòng hoặc ngăn cách bằng dấu phẩy\nVí dụ: SP001-LE, SP002-THUNG'} /><small>{manualSkuCount ? manualSkuCount.toLocaleString('vi-VN') + ' mã hàng' : 'Chưa có mã hàng'}</small></label> : null}
            <div className={styles.scopeSummary}><span>Phạm vi hiện tại</span><strong>{scopeDescription}</strong></div>
          </section>
        </div>

        <section className={styles.actionBar}>
          <div><strong>{loadingReferences ? 'Đang chuẩn bị dữ liệu…' : 'Sẵn sàng tính báo giá'}</strong><span>Giá được lấy từ chính sách bán hàng đang có hiệu lực; thao tác này không tạo đơn bán hàng.</span></div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void buildQuotation()} disabled={loadingReferences || busy !== null}>{busy === 'build' ? 'Đang tính…' : 'Tính báo giá'}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => void exportQuotation('xlsx')} disabled={busy !== null || !rows.length}>{busy === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => void exportQuotation('csv')} disabled={busy !== null || !rows.length}>{busy === 'csv' ? 'Đang xuất…' : 'Xuất CSV'}</button>
          </div>
        </section>

        <section className={styles.resultsCard}>
          <div className={styles.resultsHeader}><div><span className={styles.eyebrow}>Kết quả</span><h2>Bảng giá áp dụng</h2></div>{rows.length ? <span className={styles.resultContext}>{selectedCustomer ? selectedCustomer.code + ' · ' + selectedCustomer.name : 'Khách chung'}</span> : null}</div>
          {rows.length ? <>
            <div className={styles.summaryGrid}><div><span>Mã hàng</span><strong>{rows.length.toLocaleString('vi-VN')}</strong></div><div><span>Đã có giá</span><strong>{pricedCount.toLocaleString('vi-VN')}</strong></div><div><span>Tổng giá trị</span><strong>{formatMoney(String(totalValue), 'VND')}</strong></div></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Mã hàng</th><th>Sản phẩm / quy cách</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Nguồn giá</th></tr></thead><tbody>{rows.map((row) => <tr key={row.sku}><td><strong>{row.sku}</strong></td><td><strong>{row.product}</strong><small>{row.name || '—'}</small></td><td>{row.quantity}</td><td className={styles.money}>{formatMoney(row.finalPrice, row.currency)}</td><td className={styles.money}>{formatMoney(row.lineTotal, row.currency)}</td><td>{row.priceListCode || 'Giá áp dụng tự động'}</td></tr>)}</tbody></table></div>
          </> : <div className={styles.empty}><span className={styles.emptyIcon}>₫</span><strong>Chưa có kết quả báo giá</strong><p>Chọn điều kiện bán và phạm vi hàng hóa, sau đó bấm “Tính báo giá”.</p></div>}
        </section>
      </div>
    </AppShell>
  );
}
