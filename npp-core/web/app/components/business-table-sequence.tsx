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
  value?: number;
  className?: string;
};

type SequenceNumberProps = {
  rowIndex: number;
  offset?: number;
  value?: number;
  className?: string;
};

function resolvedSequenceNumber(rowIndex: number, offset: number, value?: number) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : businessTableRowNumber(rowIndex, offset);
}

export function BusinessTableSequenceHeader({ className }: SequenceHeaderProps) {
  return (
    <th className={className} scope="col" aria-label="Số thứ tự">
      {BUSINESS_TABLE_SEQUENCE_HEADER}
    </th>
  );
}

export function BusinessTableSequenceCell({ rowIndex, offset = 0, value, className }: SequenceCellProps) {
  return (
    <td className={className} data-business-table-sequence>
      {resolvedSequenceNumber(rowIndex, offset, value)}
    </td>
  );
}

/** Dùng cho danh sách dạng thẻ hoặc lưới, nơi không có cột bảng HTML. */
export function BusinessSequenceNumber({ rowIndex, offset = 0, value, className }: SequenceNumberProps) {
  const number = resolvedSequenceNumber(rowIndex, offset, value);
  return (
    <span className={className} data-business-sequence aria-label={`Số thứ tự ${number}`}>
      {number}
    </span>
  );
}
