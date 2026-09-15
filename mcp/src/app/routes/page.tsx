import { McpRoutesLocalPage } from "@/features/mcp/McpRoutesLocalPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return <McpRoutesLocalPage key={Date.now()} />;
}
