'use client';

import SharedVietnamAdministrativeFields from '../components/vietnam-administrative-fields';
import customerStyles from './customers.module.css';

type Props = {
  province: string;
  ward: string;
  district: string;
  onChange: (next: { province: string; ward: string; district: string }) => void;
  required?: boolean;
  testIdPrefix: string;
};

export default function VietnamAdministrativeFields(props: Props) {
  return (
    <SharedVietnamAdministrativeFields
      {...props}
      errorClassName={customerStyles.addressReferenceError}
    />
  );
}
