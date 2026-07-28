import addressData, { type Province, type Ward } from 'vietnam-address-database';

type AdministrativeRow = Province | Ward;

function rows(): AdministrativeRow[] {
  return addressData.flatMap<AdministrativeRow>((item) => (
    Array.isArray(item.data) ? item.data as AdministrativeRow[] : []
  ));
}

function isProvince(row: AdministrativeRow): row is Province {
  return 'province_code' in row && 'short_name' in row;
}

function isWard(row: AdministrativeRow): row is Ward {
  return 'ward_code' in row && 'province_code' in row && !('short_name' in row);
}

const allRows = rows();
const provinces = allRows
  .filter(isProvince)
  .map((province) => ({
    code: province.province_code,
    name: province.name,
    shortName: province.short_name,
    placeType: province.place_type,
  }))
  .sort((left, right) => left.name.localeCompare(right.name, 'vi'));

const wardsByProvince = new Map<string, Array<{ code: string; name: string }>>();
for (const ward of allRows.filter(isWard)) {
  const current = wardsByProvince.get(ward.province_code) ?? [];
  current.push({ code: ward.ward_code, name: ward.name });
  wardsByProvince.set(ward.province_code, current);
}
for (const wards of wardsByProvince.values()) {
  wards.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

export function listVietnamProvinces() {
  return provinces;
}

export function listVietnamWards(provinceCode: string) {
  return wardsByProvince.get(provinceCode) ?? [];
}
