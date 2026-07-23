type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">○</div>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="action-row">{action}</div> : null}
    </div>
  );
}
