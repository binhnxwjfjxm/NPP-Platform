export const APPEARANCE_THEME_STORAGE_KEY = 'hp-company-appearance-theme';
export const APPEARANCE_SCALE_STORAGE_KEY = 'hp-company-appearance-scale';
export const APPEARANCE_CHANGE_EVENT = 'hp-company-appearance-change';

export type AppearanceTheme = 'default' | 'green' | 'dark';
export type AppearanceScale = -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4;

export const APPEARANCE_THEMES: ReadonlyArray<{
  key: AppearanceTheme;
  label: string;
  description: string;
}> = [
  {
    key: 'default',
    label: 'Mặc định',
    description: 'Giữ nguyên giao diện Công Ty hiện tại.',
  },
  {
    key: 'green',
    label: 'Xanh lá',
    description: 'Nền nội dung trắng, thanh điều hướng và điểm nhấn dùng hệ xanh lá.',
  },
  {
    key: 'dark',
    label: 'Tối',
    description: 'Nền tối đồng bộ cho nội dung, bảng, trường nhập và thanh điều hướng.',
  },
];

export const APPEARANCE_SCALE_LEVELS: readonly AppearanceScale[] = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

export function normalizeAppearanceTheme(value: string | null | undefined): AppearanceTheme {
  return value === 'green' || value === 'dark' ? value : 'default';
}

export function normalizeAppearanceScale(value: string | number | null | undefined): AppearanceScale {
  const parsed = Number(value);
  return APPEARANCE_SCALE_LEVELS.includes(parsed as AppearanceScale) ? parsed as AppearanceScale : 0;
}

export function applyAppearance(theme: AppearanceTheme, scale: AppearanceScale, root: HTMLElement) {
  root.dataset.hpTheme = theme;
  root.dataset.hpScale = String(scale);
}
