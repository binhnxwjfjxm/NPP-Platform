import styles from "./TodaySummaryCard.module.css";
type SummaryPill={label:string;value:string|number};
type Props={eyebrow:string;value:string|number;description:string;pills?:SummaryPill[];tone?:"dark"|"teal"};
export function TodaySummaryCard({eyebrow,value,description,pills=[],tone="dark"}:Props){
  return <section className={`${styles.card} ${tone==="teal"?styles.teal:""}`}>
    <div className={styles.main}><span>{eyebrow}</span><h2>{value}</h2><p>{description}</p></div>
    {pills.length?<div className={styles.pills}>{pills.map(p=><strong key={p.label}>{p.value} {p.label}</strong>)}</div>:null}
  </section>;
}
