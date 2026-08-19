import {
  BUSINESS_TABLE_SEQUENCE_HEADER,
  businessTableRowNumber,
} from '../../lib/business-table-numbering';

type SequenceHeaderProps = {
  className?: string;
};

type SequenceCellProps = {
  rowIndex: number;
  offset?: number;
  className?: string;
};

type SequenceNumberProps = {
  rowIndex: number;
  offset?: number;
  className?: string;
};

export function BusinessTableSequenceHeader({ className }: SequenceHeaderProps) {
  return (
    <th className={className} scope="col" aria-label="Số thứ tự">
      {BUSINESS_TABLE_SEQUENCE_HEADER}
    </th>
  );
}

export function BusinessTableSequenceCell({ rowIndex, offset = 0, className }: SequenceCellProps) {
  return (
    <td className={className} data-business-table-sequence>
      {businessTableRowNumber(rowIndex, offset)}
    </td>
  );
}

/** Dùng cho danh sách dạng thẻ hoặc lưới, nơi không có cột bảng HTML. */
export function BusinessSequenceNumber({ rowIndex, offset = 0, className }: SequenceNumberProps) {
  return (
    <span className={className} data-business-sequence aria-label={`Số thứ tự ${businessTableRowNumber(rowIndex, offset)}`}>
      {businessTableRowNumber(rowIndex, offset)}
    </span>
  );
}
