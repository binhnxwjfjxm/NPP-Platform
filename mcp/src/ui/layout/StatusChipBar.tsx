type StatusChip = {
  label: string;
  value?: string | number;
  active?: boolean;
};

type StatusChipBarProps = {
  chips: StatusChip[];
  ariaLabel?: string;
};

export function StatusChipBar({ chips, ariaLabel = "Bo loc trang thai" }: StatusChipBarProps) {
  return (
    <div className="mcp-status-chips" aria-label={ariaLabel}>
      {chips.map((chip, index) => (
        <button className={chip.active ?? index === 0 ? "active" : undefined} key={chip.label} type="button">
          {chip.label}{chip.value !== undefined ? <b>{chip.value}</b> : null}
        </button>
      ))}
    </div>
  );
}
