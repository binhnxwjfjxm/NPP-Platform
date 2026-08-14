'use client';

import { useState } from 'react';
import type { CodAssignment } from '../../../lib/types';
import CodCollectionPanel from './cod-collection-panel';
import MobileActionDialog from './mobile-action-dialog';
import styles from './cod-collection-dialog.module.css';

type Props = Readonly<{ tripId: string; assignment: CodAssignment }>;

export default function CodCollectionDialog({ tripId, assignment }: Props) {
  const [open, setOpen] = useState(false);
  const recorded = Boolean(assignment.collection);
  return (
    <div data-testid={`cod-workflow-${assignment.assignmentId}`}>
      <button className={styles.trigger} type="button" onClick={() => setOpen(true)}>
        {recorded ? 'Xem COD' : 'Thu COD'}
      </button>
      <MobileActionDialog
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Tiền thu khi giao"
        title={assignment.deliveryOrderNumber || 'COD'}
      >
        <CodCollectionPanel
          tripId={tripId}
          assignment={assignment}
          onCompleted={() => setOpen(false)}
        />
      </MobileActionDialog>
    </div>
  );
}
