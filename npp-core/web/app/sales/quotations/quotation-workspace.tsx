'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import type { Category, Channel, Customer, CustomerGroup, OfficialRows, Product, Variant } from '../../operations/data-exchange/data-exchange-model';
import type { SalesOrderSkuSearchOption } from '../../../lib/sales-order-types';
import { MIN_PRODUCT_SEARCH_LENGTH } from '../../../lib/product-search-contract';
import { exactQuantity, exportTable, idempotency, requestJson } from '../../operations/data-exchange/data-exchange-file-utils';
import styles from './quotation-workspace.module.css';

type Scope = 'all' | 'category' | 'sku';
type BusyAction = 'build' | 'xlsx' | 'csv' | null;
type QuotationRow = {
  sku: string; name: string; product: string; quantity: string;
  systemPrice: string; manualPrice: string; lineTotal: string; priceListCode: string; currency: string;
};
type SkuSearchOption = Omit<SalesOrderSkuSearchOption, 'pricePreview' | 'inventoryPreview'>;

const PRODUCT_PAGE_SIZE = 1000;
const MAX_PRODUCT_OFFSET = 10000;
const VARIANT_BATCH_SIZE = 500;
const MAX_QUOTATION_SKUS = 1000;
const SEARCH_PAGE_SIZE = 30;
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

function formatVndInput(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
}

function lineTotalForPrice(priceMinor: string, quantity: string) {
  if (!/^\d+$/.test(priceMinor)) return '';
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(quantity.trim());
  if (!match) return '';
  const scale = 1_000_000n;
  const scaledQuantity = BigInt(match[1]) * scale + BigInt((match[2] ?? '').padEnd(6, '0'));
  return ((BigInt(priceMinor) * scaledQuantity + scale / 2n) / scale).toString();
}

function effectiveUnitPrice(row: QuotationRow) {
  return row.manualPrice || row.systemPrice;
}

function effectiveLineTotal(row: QuotationRow) {
  return row.manualPrice ? lineTotalForPrice(row.manualPrice, row.quantity) : row.lineTotal;
}

export default function QuotationWorkspace() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [scope, setScope] = useState<Scope>('all');
  const [categoryId, setCategoryId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [customerGroupId, setCustomerGroupId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [skuTerm, setSkuTerm] = useState('');
  const [skuResults, setSkuResults] = useState<SkuSearchOption[]>([]);
  const [selectedSkus, setSelectedSkus] = useState<SkuSearchOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuSearchOpen, setSkuSearchOpen] = useState(false);
  const [activeSkuIndex, setActiveSkuIndex] = useState(0);
  const [quantity, setQuantity] = useState('1');
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operationKeyRef = useRef<string | null>(null);
  const skuSearchRunRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingReferences(true);
    Promise.all([
      requestJson<Category[]>('/api/product-categories?limit=1000'),
      requestJson<Channel[]>('/api/sales-channels?limit=1000'),
      requestJson<CustomerGroup[]>('/api/customer-groups?limit=1000'),
      requestJson<Customer[]>('/api/customers?limit=1000'),
    ]).then(([nextCategories, nextChannels, nextGroups, nextCustomers]) => {
      if (cancelled) return;
      setCategories(nextCategories); setChannels(nextChannels); setGroups(nextGroups); setCustomers(nextCustomers); setError('');
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu để lập báo giá.');
    }).finally(() => {
      if (!cancelled) setLoadingReferences(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const term = skuTerm.trim();
    const run = ++skuSearchRunRef.current;
    setActiveSkuIndex(0);
    if (scope !== 'sku' || term.length < MIN_PRODUCT_SEARCH_LENGTH) {
      setSkuResults([]);
      setSkuLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSkuLoading(true);
      try {
        const query = new URLSearchParams({ search: term, limit: String(SEARCH_PAGE_SIZE), offset: '0' });
        const found = await requestJson<SkuSearchOption[]>(`/api/sales-orders/sku-search?${query.toString()}`, { signal: controller.signal });
        if (controller.signal.aborted || run !== skuSearchRunRef.current) return;
        setSkuResults(found);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Không tìm được hàng hóa.');
      } finally {
        if (!controller.signal.aborted && run === skuSearchRunRef.current) setSkuLoading(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scope, skuTerm]);

  const selectedCustomer = useMemo(() => customers.find((item) => item.id === customerId) ?? null, [customers, customerId]);
  const selectedCategory = useMemo(() => categories.find((item) => item.id === categoryId) ?? null, [categories, categoryId]);
  const filteredCustomers = useMemo(() => {
    const term = customerQuery.trim().toLocaleLowerCase('vi-VN');
    return customers
      .filter((item) => item.is_active)
      .filter((item) => !term || item.code.toLocaleLowerCase('vi-VN').includes(term) || item.name.toLocaleLowerCase('vi-VN').includes(term))
      .slice(0, SEARCH_PAGE_SIZE);
  }, [customers, customerQuery]);

  const pricedCount = rows.filter((row) => effectiveUnitPrice(row) !== '').length;
  const totalValue = rows.reduce((sum, row) => {
    const value = Number(effectiveLineTotal(row));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const manualSkuCount = selectedSkus.length;

  function invalidateResult() {
    operationKeyRef.current = null;
    setRows([]); setError(''); setMessage('');
  }

  function changeScope(next: Scope) {
    invalidateResult();
    setScope(next);
    setSkuTerm('');
    setSkuResults([]);
    setSkuSearchOpen(false);
  }

  function changeCustomer(nextId: string) {
    invalidateResult();
    setCustomerId(nextId);
    const customer = customers.find((item) => item.id === nextId);
    setCustomerGroupId(customer?.group_id ?? '');
  }

  function selectCustomer(customer: Customer) {
    changeCustomer(customer.id);
    setCustomerQuery('');
    setCustomerSearchOpen(false);
  }

  function clearCustomer() {
    changeCustomer('');
    setCustomerQuery('');
    setCustomerSearchOpen(false);
  }

  function addSelectedSku(option: SkuSearchOption) {
    if (!option.eligibility.selectable) {
      setError(option.eligibility.message || 'Mã hàng này chưa đủ điều kiện bán.');
      return;
    }
    if (selectedSkus.some((item) => item.id === option.id || item.sku === option.sku)) {
      setSkuTerm('');
      setSkuResults([]);
      setSkuSearchOpen(false);
      return;
    }
    if (selectedSkus.length >= MAX_QUOTATION_SKUS) {
      setError('Mỗi báo giá tối đa 1.000 mã hàng.');
      return;
    }
    invalidateResult();
    setSelectedSkus((current) => [...current, option]);
    setSkuTerm('');
    setSkuResults([]);
    setSkuSearchOpen(false);
  }

  function removeSelectedSku(id: string) {
    invalidateResult();
    setSelectedSkus((current) => current.filter((item) => item.id !== id));
  }

  function handleSkuKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSkuIndex((current) => Math.min(current + 1, Math.max(0, skuResults.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSkuIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && skuResults[activeSkuIndex]) {
      event.preventDefault();
      addSelectedSku(skuResults[activeSkuIndex]);
    }
  }

  function updateManualPrice(sku: string, value: string) {
    const digits = value.replace(/\D/g, '');
    setRows((current) => current.map((row) => row.sku === sku ? { ...row, manualPrice: digits } : row));
    setError('');
    setMessage('');
  }

  function useSystemPrice(sku: string) {
    setRows((current) => current.map((row) => row.sku === sku ? { ...row, manualPrice: '' } : row));
    setError('');
    setMessage('');
  }

  async function buildQuotation() {
    if (loadingReferences || busy) return;
    setBusy('build'); setError(''); setMessage('');
    try {
      const normalizedQuantity = exactQuantity(quantity, 'quantity', 6);
      if (/^0(?:\.0+)?$/.test(normalizedQuantity)) throw new Error('Số lượng phải lớn hơn 0.');
      let skus: string[] = [];
      if (scope === 'sku') {
        if (!selectedSkus.length) throw new Error('Chọn ít nhất một mã hàng cần báo giá.');
        skus = selectedSkus.map((item) => item.sku);
      } else {
        const products = await loadAllProducts();
        const activeProducts = products.filter((product) => product.is_active && product.is_orderable);
        let selectedProducts = activeProducts;
        if (scope === 'category') {
          if (!categoryId) throw new Error('Chọn ngành hoặc nhóm sản phẩm cần báo giá.');
          selectedProducts = activeProducts.filter((product) => product.category_id === categoryId);
        }
        if (!selectedProducts.length) throw new Error('Không có sản phẩm đang bán phù hợp với phạm vi đã chọn.');
        const variants = await loadVariantsForProducts(selectedProducts.map((product) => product.id));
        skus = [...new Set(
          variants.filter((variant) => variant.is_active && variant.is_sellable).map((variant) => variant.sku),
        )].sort();
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
        systemPrice: String(row.unitPriceMinor ?? ''),
        manualPrice: '',
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
        row.sku,
        row.product,
        row.name,
        row.quantity,
        row.currency,
        effectiveUnitPrice(row),
        effectiveLineTotal(row),
        row.manualPrice ? 'Giá chỉnh trên báo giá' : row.priceListCode,
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
              <div className={styles.span2 + ' ' + styles.field}>
                <span>Tìm khách hàng</span>
                <div className={styles.searchBox}>
                  <input
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={customerSearchOpen && Boolean(customerQuery.trim())}
                    aria-controls="quotation-customer-results"
                    value={customerQuery}
                    onFocus={() => setCustomerSearchOpen(Boolean(customerQuery.trim()))}
                    onBlur={() => window.setTimeout(() => setCustomerSearchOpen(false), 0)}
                    onChange={(event) => { setCustomerQuery(event.target.value); setCustomerSearchOpen(Boolean(event.target.value.trim())); }}
                    placeholder="Nhập mã hoặc tên khách hàng"
                    autoComplete="off"
                    data-testid="quotation-customer-search"
                  />
                  {customerSearchOpen && customerQuery.trim() ? (
                    <div id="quotation-customer-results" className={styles.searchResults} role="listbox" aria-label="Kết quả tìm khách hàng" data-testid="quotation-customer-results">
                      {filteredCustomers.length ? filteredCustomers.map((customer) => (
                        <button type="button" key={customer.id} className={styles.searchOption} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCustomer(customer)}>
                          <span><strong>{customer.name}</strong><small>{customer.code}</small></span>
                          <b>Chọn</b>
                        </button>
                      )) : <div className={styles.searchEmpty}>Không tìm thấy khách hàng phù hợp.</div>}
                    </div>
                  ) : null}
                </div>
                {selectedCustomer ? (
                  <div className={styles.selectedCustomer} data-testid="quotation-selected-customer">
                    <span><strong>{selectedCustomer.name}</strong><small>{selectedCustomer.code}</small></span>
                    <button type="button" onClick={clearCustomer}>Bỏ chọn</button>
                  </div>
                ) : <small>Để trống nếu báo giá theo mức giá chung.</small>}
              </div>
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
            {scope === 'sku' ? <div className={styles.productPicker}>
              <div className={styles.field}>
                <span>Tìm sản phẩm / mã hàng</span>
                <div className={styles.searchBox}>
                  <input
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={skuSearchOpen && Boolean(skuTerm.trim())}
                    aria-controls="quotation-sku-results"
                    value={skuTerm}
                    onFocus={() => setSkuSearchOpen(Boolean(skuTerm.trim()))}
                    onBlur={() => window.setTimeout(() => setSkuSearchOpen(false), 0)}
                    onChange={(event) => { setSkuTerm(event.target.value); setSkuSearchOpen(Boolean(event.target.value.trim())); }}
                    onKeyDown={handleSkuKeyDown}
                    placeholder="Tên sản phẩm, mã hàng, SKU hoặc barcode"
                    autoComplete="off"
                    data-testid="quotation-sku-search"
                  />
                  {skuSearchOpen && skuTerm.trim() ? (
                    <div id="quotation-sku-results" className={styles.searchResults} role="listbox" aria-label="Kết quả tìm hàng hóa" data-testid="quotation-sku-results">
                      {skuLoading ? <div className={styles.searchEmpty}>Đang tìm hàng hóa…</div> : null}
                      {!skuLoading && skuResults.length === 0 ? <div className={styles.searchEmpty}>Không tìm thấy hàng hóa phù hợp.</div> : null}
                      {skuResults.map((option, index) => (
                        <button
                          type="button"
                          key={option.id}
                          className={index === activeSkuIndex ? styles.searchOptionActive : styles.searchOption}
                          disabled={!option.eligibility.selectable}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addSelectedSku(option)}
                        >
                          <span><strong>{option.productName}</strong><small>SKU {option.sku} · {option.productCode}{option.variantName ? ' · ' + option.variantName : ''}</small>{option.barcode ? <small>Barcode {option.barcode}</small> : null}</span>
                          <b>{option.eligibility.selectable ? 'Thêm' : option.eligibility.message}</b>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <small>Gõ để tìm, ↑↓ để chọn, Enter để thêm. Dùng đúng danh mục tìm hàng của màn Ra đơn.</small>
              </div>
              {selectedSkus.length ? <div className={styles.selectedSkuList} data-testid="quotation-selected-skus">
                {selectedSkus.map((item) => <div className={styles.selectedSkuItem} key={item.id}><span><strong>{item.productName}</strong><small>SKU {item.sku}{item.variantName ? ' · ' + item.variantName : ''}{item.unitCode ? ' · ' + item.unitCode : ''}</small></span><button type="button" onClick={() => removeSelectedSku(item.id)}>Bỏ</button></div>)}
              </div> : <div className={styles.searchEmpty}>Chưa chọn mã hàng.</div>}
            </div> : null}
            <div className={styles.scopeSummary}><span>Phạm vi hiện tại</span><strong>{scopeDescription}</strong></div>
          </section>
        </div>

        <section className={styles.actionBar}>
          <div><strong>{loadingReferences ? 'Đang chuẩn bị dữ liệu…' : 'Sẵn sàng tính báo giá'}</strong><span>Giá hệ thống là giá đề xuất ban đầu. Có thể chỉnh trực tiếp từng dòng trên báo giá mà không thay đổi bảng giá Công Ty.</span></div>
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
            <div className={styles.tableWrap}><table><thead><tr><th>Mã hàng</th><th>Sản phẩm / quy cách</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Nguồn giá</th></tr></thead><tbody>{rows.map((row) => <tr key={row.sku}><td><strong>{row.sku}</strong></td><td><strong>{row.product}</strong><small>{row.name || '—'}</small></td><td>{row.quantity}</td><td className={styles.money}><div className={styles.priceEditor}><input aria-label={`Đơn giá ${row.sku}`} inputMode="numeric" value={formatVndInput(effectiveUnitPrice(row))} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => updateManualPrice(row.sku, event.target.value)} />{row.manualPrice ? <div className={styles.priceMeta}><span>Giá chỉnh trên báo giá</span><button type="button" onClick={() => useSystemPrice(row.sku)}>Giá hệ thống</button></div> : null}</div></td><td className={styles.money}>{formatMoney(effectiveLineTotal(row), row.currency)}</td><td>{row.manualPrice ? <><strong>Giá chỉnh trên báo giá</strong><small>{row.priceListCode ? 'Giá hệ thống: ' + row.priceListCode : 'Giá hệ thống tự động'}</small></> : (row.priceListCode || 'Giá áp dụng tự động')}</td></tr>)}</tbody></table></div>
          </> : <div className={styles.empty}><span className={styles.emptyIcon}>₫</span><strong>Chưa có kết quả báo giá</strong><p>Chọn điều kiện bán và phạm vi hàng hóa, sau đó bấm “Tính báo giá”.</p></div>}
        </section>
      </div>
    </AppShell>
  );
}