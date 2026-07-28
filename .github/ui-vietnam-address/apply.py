from pathlib import Path
import re

workspace_path = Path('npp-core/web/app/customers/customer-workspace.tsx')
workspace = workspace_path.read_text(encoding='utf-8')

workspace = workspace.replace(
    "import customerStyles from './customers.module.css';\n",
    "import customerStyles from './customers.module.css';\nimport VietnamAdministrativeFields from './vietnam-administrative-fields';\n",
    1,
)

workspace, removed = re.subn(
    r"\nconst VIETNAM_PROVINCES = \[[\s\S]*?\] as const;\n",
    "\n",
    workspace,
    count=1,
)
assert removed == 1, 'province constant not found'

create_old = '''                      <label>Tỉnh/thành phố<select data-testid="customer-province-select" value={addressDraft.province} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, province: next })); }} required><option value="">Chọn tỉnh/thành phố</option>{VIETNAM_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
                      <label>Quận/huyện<input value={addressDraft.district} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, district: next })); }} /></label>
                      <label>Phường/xã<input value={addressDraft.ward} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, ward: next })); }} /></label>'''
create_new = '''                      <VietnamAdministrativeFields
                        province={addressDraft.province}
                        ward={addressDraft.ward}
                        district={addressDraft.district}
                        onChange={(next) => setAddressDraft((value) => ({ ...value, ...next }))}
                        required
                        testIdPrefix="customer"
                      />'''
assert create_old in workspace, 'create address fields not found'
workspace = workspace.replace(create_old, create_new, 1)

edit_old = '''                        <label>Phường/xã<input value={addressDraft.ward} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, ward: next })); }} /></label>
                        <label>Quận/huyện<input value={addressDraft.district} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, district: next })); }} /></label>
                        <label>Tỉnh/thành phố<select data-testid="customer-address-province-select" value={addressDraft.province} onChange={(event) => { const next = event.currentTarget.value; setAddressDraft((value) => ({ ...value, province: next })); }}><option value="">Chọn tỉnh/thành phố</option>{VIETNAM_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>'''
edit_new = '''                        <VietnamAdministrativeFields
                          province={addressDraft.province}
                          ward={addressDraft.ward}
                          district={addressDraft.district}
                          onChange={(next) => setAddressDraft((value) => ({ ...value, ...next }))}
                          required
                          testIdPrefix="customer-address"
                        />'''
assert edit_old in workspace, 'edit address fields not found'
workspace = workspace.replace(edit_old, edit_new, 1)

employee_effect = '''  useEffect(() => {
    void requestJson<EmployeeOption[]>('/api/access/employees?active=true&limit=1000')
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);
'''
escape_effect = employee_effect + '''
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy !== null) return;
      if (addressEditor) {
        setAddressEditor(null);
        return;
      }
      if (addressCustomerId) {
        setAddressCustomerId(null);
        setAddressEditor(null);
        return;
      }
      if (groupEditor) {
        setGroupEditor(null);
        return;
      }
      if (customerEditor) {
        closeCustomerEditor();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addressCustomerId, addressEditor, busy, customerEditor, groupEditor, pendingCreatedCustomer]);
'''
assert employee_effect in workspace, 'employee effect anchor not found'
workspace = workspace.replace(employee_effect, escape_effect, 1)

workspace = workspace.replace(
    '<div className={styles.modalBackdrop} role="presentation">\n            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Biểu mẫu khách hàng">',
    '<div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && busy === null) closeCustomerEditor(); }}>\n            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Biểu mẫu khách hàng">',
    1,
)
workspace = workspace.replace(
    '<div className={styles.modalBackdrop} role="presentation">\n            <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Biểu mẫu nhóm khách hàng">',
    '<div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && busy === null) setGroupEditor(null); }}>\n            <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Biểu mẫu nhóm khách hàng">',
    1,
)
workspace = workspace.replace(
    '<div className={styles.modalBackdrop} role="presentation">\n            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Quản lý địa chỉ khách hàng">',
    '<div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && busy === null) { setAddressCustomerId(null); setAddressEditor(null); } }}>\n            <section className={joinClasses(styles.modal, customerStyles.modalWide)} role="dialog" aria-modal="true" aria-label="Quản lý địa chỉ khách hàng">',
    1,
)
workspace = workspace.replace(
    'className={styles.modalClose} onClick={() => setGroupEditor(null)}>Đóng</button>',
    'className={styles.modalClose} onClick={() => setGroupEditor(null)} disabled={busy !== null}>Đóng</button>',
    1,
)
workspace = workspace.replace(
    'className={styles.secondaryButton} onClick={() => setGroupEditor(null)}>Hủy</button>',
    'className={styles.secondaryButton} onClick={() => setGroupEditor(null)} disabled={busy !== null}>Hủy</button>',
    1,
)
workspace = workspace.replace(
    'className={styles.modalClose} onClick={() => { setAddressCustomerId(null); setAddressEditor(null); }}>Đóng</button>',
    'className={styles.modalClose} onClick={() => { setAddressCustomerId(null); setAddressEditor(null); }} disabled={busy !== null}>Đóng</button>',
    1,
)
workspace_path.write_text(workspace, encoding='utf-8')

css_path = Path('npp-core/web/app/customers/customers.module.css')
css = css_path.read_text(encoding='utf-8')
if '.addressReferenceError' not in css:
    css += '''

.addressReferenceError {
  grid-column: 1 / -1;
  padding: 9px 11px;
  border: 1px solid #efc9c2;
  border-radius: 8px;
  background: #fff6f4;
  color: #8f2f22;
  font-size: 0.74rem;
}
'''
css_path.write_text(css, encoding='utf-8')

test_path = Path('npp-core/web/test/ui-live-fixes.test.js')
test = test_path.read_text(encoding='utf-8')
test = test.replace(
    "    readSource('../app/customers/page.tsx'),\n    readSource('../app/layout.tsx'),\n",
    "    readSource('../app/customers/page.tsx'),\n    readSource('../app/layout.tsx'),\n    readSource('../app/customers/vietnam-administrative-fields.tsx'),\n    readSource('../app/api/reference/vietnam-administrative-units/route.ts'),\n",
    1,
)
test = test.replace(
    '  const [workspace, page, layout] = await Promise.all([',
    '  const [workspace, page, layout, addressFields, addressRoute] = await Promise.all([',
    1,
)
test = test.replace(
    '  assert.match(workspace, /const VIETNAM_PROVINCES = \\[/);\n',
    "  assert.match(workspace, /VietnamAdministrativeFields/);\n  assert.doesNotMatch(workspace, /const VIETNAM_PROVINCES = \\[/);\n  assert.match(addressFields, /provinceCode=/);\n  assert.match(addressFields, /Xã\\/phường\\/đặc khu/);\n  assert.match(addressRoute, /listVietnamWards/);\n",
    1,
)
test_path.write_text(test, encoding='utf-8')

e2e_path = Path('npp-core/web/e2e/customers.spec.ts')
e2e = e2e_path.read_text(encoding='utf-8')
e2e = e2e.replace(
    "    await page.getByTestId('customer-province-select').selectOption({ label: 'Hà Nội' });\n",
    "    await page.getByTestId('customer-province-select').selectOption({ label: 'Hà Nội' });\n    await page.getByTestId('customer-ward-select').selectOption({ index: 1 });\n",
    1,
)
e2e = e2e.replace(
    "    await page.getByTestId('customer-address-province-select').selectOption({ label: 'Hà Nội' });\n",
    "    await page.getByTestId('customer-address-province-select').selectOption({ label: 'Hà Nội' });\n    await page.getByTestId('customer-address-ward-select').selectOption({ index: 1 });\n",
    1,
)
e2e_path.write_text(e2e, encoding='utf-8')
