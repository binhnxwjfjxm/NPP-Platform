import { Fragment, type ReactNode } from "react";

type OperationalAction = {
  label: string;
  tone?: "primary" | "secondary";
  onClick?: () => void;
  href?: string;
};

type OperationalListCardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  badge?: ReactNode;
  leading?: ReactNode;
  meta?: string[];
  actions?: OperationalAction[];
  actionContent?: ReactNode;
};

function singleOrderPdfHref(href: string) {
  try {
    const url = new URL(href, "https://mcp-plan.local");
    if (url.pathname !== "/api/backend/exports/orders.csv") return "";
    const orderId = String(url.searchParams.get("orderId") || "").trim();
    return orderId ? `/api/pdf/order?orderId=${encodeURIComponent(orderId)}` : "";
  } catch {
    return "";
  }
}

export function OperationalListCard({ eyebrow, title, description, badge, leading, meta = [], actions = [], actionContent }: OperationalListCardProps) {
  return (
    <article className="operational-list-card">
      {leading ? <div className="operational-list-leading">{leading}</div> : null}
      <div className="operational-list-body">
        <div className="operational-list-head">
          <div className="operational-list-title-wrap">
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h3>{title}</h3>
          </div>
          {badge ? <div className="operational-list-badge">{badge}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
        {meta.length > 0 ? <div className="operational-list-meta">{meta.slice(0, 3).map((item) => <small key={item}>{item}</small>)}</div> : null}
      </div>
      {actions.length > 0 || actionContent ? <div className="operational-list-actions">{actions.map((action) => {
        const className = action.tone === "primary" ? "button primary" : "button";
        if (action.href) {
          const pdfHref = singleOrderPdfHref(action.href);
          return <Fragment key={action.label}>
            {pdfHref ? <a className="button" href={pdfHref} target="_blank" rel="noreferrer">PDF A5</a> : null}
            <a className={className} href={action.href}>{action.label}</a>
          </Fragment>;
        }
        return <button className={className} key={action.label} type="button" onClick={action.onClick}>{action.label}</button>;
      })}{actionContent}</div> : null}
    </article>
  );
}
