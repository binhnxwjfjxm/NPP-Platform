'use client';

import type { ComponentProps } from 'react';
import SalesOrderCommercialForm from './SalesOrderCommercialForm';
import styles from './sales-orders.module.css';

export { type SalesOrderFormMode } from './SalesOrderCommercialForm';

type SalesOrderFormProps = ComponentProps<typeof SalesOrderCommercialForm>;

export default function SalesOrderForm(props: SalesOrderFormProps) {
  return (
    <>
      <SalesOrderCommercialForm {...props} />
      <style>{`.${styles.orderEditorBody}{grid-auto-rows:max-content}`}</style>
    </>
  );
}
