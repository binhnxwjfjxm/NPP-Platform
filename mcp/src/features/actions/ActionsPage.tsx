import { createApiClient } from "@/lib/api/api-client";
import { ActionsClientPage } from "./ActionsClientPage";

export async function ActionsPage() {
  const api = createApiClient();
  const actionsResult = await api.getActionsData();

  return <ActionsClientPage kpis={actionsResult.data.kpis} items={actionsResult.data.items} />;
}
