type FilterItem = {
  label: string;
  value: string;
};

type FilterBarProps = {
  title?: string;
  filters: FilterItem[];
};

export function FilterBar({ title = "Bộ lọc nhanh", filters }: FilterBarProps) {
  return (
    <div className="filter-bar">
      <strong>{title}</strong>
      <div className="filter-list">
        {filters.map((filter) => (
          <span className="filter-chip" key={`${filter.label}-${filter.value}`}>
            {filter.label}: <b>{filter.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
