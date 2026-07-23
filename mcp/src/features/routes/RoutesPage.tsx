import { routesMock } from "./routes.mock";
import { RoutesClientPage } from "./RoutesClientPage";

export function RoutesPage() {
  return <RoutesClientPage kpis={routesMock.kpis} routes={routesMock.routes} />;
}
