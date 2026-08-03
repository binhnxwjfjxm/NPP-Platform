import { loadActionsData } from "@/lib/api/actions-data";
import { ActionsClientPage } from "./ActionsClientPage";

export async function ActionsPage() {
  const actionsData = await loadActionsData();

  return <ActionsClientPage kpis={actionsData.kpis} items={actionsData.items} />;
}
