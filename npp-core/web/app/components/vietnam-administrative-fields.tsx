'use client';

import { useEffect, useMemo, useState } from 'react';

type ProvinceOption = {
  code: string;
  name: string;
  shortName: string;
  placeType: string;
};

type WardOption = {
  code: string;
  name: string;
};

type Envelope = {
  data?: {
    provinces?: ProvinceOption[];
    wards?: WardOption[];
  };
  error?: { message?: string };
};

type Props = {
  province: string;
  ward: string;
  district: string;
  onChange: (next: { province: string; ward: string; district: string }) => void;
  required?: boolean;
  testIdPrefix: string;
  errorClassName?: string;
};

async function loadReference(path: string) {
  const response = await fetch(path, { cache: 'force-cache' });
  const payload = await response.json().catch(() => ({})) as Envelope;
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message || 'Không tải được danh mục hành chính Việt Nam');
  }
  return payload.data;
}

export default function VietnamAdministrativeFields({
  province,
  ward,
  district,
  onChange,
  required = false,
  testIdPrefix,
  errorClassName,
}: Props) {
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const [wards, setWards] = useState<WardOption[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingWards, setLoadingWards] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingProvinces(true);
    loadReference('/api/reference/vietnam-administrative-units')
      .then((data) => {
        if (!active) return;
        setProvinces(data.provinces ?? []);
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Không tải được danh mục tỉnh/thành');
      })
      .finally(() => {
        if (active) setLoadingProvinces(false);
      });
    return () => { active = false; };
  }, []);

  const selectedProvince = useMemo(
    () => provinces.find((item) => item.name === province || item.shortName === province) ?? null,
    [province, provinces],
  );

  useEffect(() => {
    let active = true;
    if (!selectedProvince) {
      setWards([]);
      return () => { active = false; };
    }

    setLoadingWards(true);
    loadReference(`/api/reference/vietnam-administrative-units?provinceCode=${encodeURIComponent(selectedProvince.code)}`)
      .then((data) => {
        if (!active) return;
        setWards(data.wards ?? []);
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setWards([]);
        setError(caught instanceof Error ? caught.message : 'Không tải được danh mục xã/phường');
      })
      .finally(() => {
        if (active) setLoadingWards(false);
      });

    return () => { active = false; };
  }, [selectedProvince]);

  return (
    <>
      <label>
        Tỉnh/thành phố
        <select
          data-testid={`${testIdPrefix}-province-select`}
          value={selectedProvince?.name ?? province}
          onChange={(event) => onChange({ province: event.currentTarget.value, ward: '', district: '' })}
          required={required}
          disabled={loadingProvinces}
        >
          <option value="">{loadingProvinces ? 'Đang tải tỉnh/thành…' : 'Chọn tỉnh/thành phố'}</option>
          {provinces.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}
        </select>
      </label>

      <label>
        Xã/phường/đặc khu
        <select
          data-testid={`${testIdPrefix}-ward-select`}
          value={ward}
          onChange={(event) => onChange({ province, ward: event.currentTarget.value, district: '' })}
          required={required}
          disabled={!selectedProvince || loadingWards}
        >
          <option value="">
            {!selectedProvince ? 'Chọn tỉnh/thành trước' : loadingWards ? 'Đang tải xã/phường…' : 'Chọn xã/phường/đặc khu'}
          </option>
          {wards.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}
        </select>
      </label>

      {district ? (
        <label>
          Quận/huyện (dữ liệu cũ)
          <input
            value={district}
            onChange={(event) => onChange({ province, ward, district: event.currentTarget.value })}
          />
        </label>
      ) : null}

      {error ? <div className={errorClassName} role="alert">{error}</div> : null}
    </>
  );
}
