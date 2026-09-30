import { Fragment, type ReactNode } from "react";
import styles from "./OperationalListCard.module.css";

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
    <article className={styles.card} data-operational-list-card="true">
      {leading ? <div className={styles.leading}>{leading}</div> : null}
      <div className={styles.body}>
        <div className={styles.head}>
          <div className={styles.titleWrap}>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h3>{title}</h3>
          </div>
          {badge ? <div className={styles.badge}>{badge}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
        {meta.length > 0 ? <div className={styles.meta}>{meta.slice(0, 3).map((item) => <small key={item}>{item}</small>)}</div> : null}
      </div>
      {actions.length > 0 || actionContent ? <div className={styles.actions}>{actions.map((action) => {
        const className = action.tone === "primary" ? styles.actionPrimary : styles.action;
        if (action.href) {
          const pdfHref = singleOrderPdfHref(action.href);
          return <Fragment key={action.label}>
            {pdfHref ? <a className={styles.action} href={pdfHref} target="_blank" rel="noreferrer">PDF A5</a> : null}
            <a className={className} href={action.href}>{action.label}</a>
          </Fragment>;
        }
        return <button className={className} key={action.label} type="button" onClick={action.onClick}>{action.label}</button>;
      })}{actionContent}</div> : null}
    </article>
  );
}
