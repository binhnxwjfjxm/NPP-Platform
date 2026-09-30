import { McpPageHeader } from "@/ui/foundation";
type Props={eyebrow?:string;title:string;subtitle?:string;children?:React.ReactNode};
export function PageHeader({eyebrow,title,subtitle,children}:Props){return <McpPageHeader eyebrow={eyebrow} title={title} description={subtitle} actions={children}/>;}
