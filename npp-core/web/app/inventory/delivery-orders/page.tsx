import DeliveryOrderWorkspace from './delivery-order-workspace';
import DeliveryOrderPrintDock from './DeliveryOrderPrintDock';

export const dynamic = 'force-dynamic';

export default function DeliveryOrderPage() {
  return (
    <>
      <DeliveryOrderWorkspace />
      <DeliveryOrderPrintDock />
    </>
  );
}
