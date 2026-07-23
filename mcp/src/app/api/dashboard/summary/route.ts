import { fail, ok } from "@/server/http/api-response";
import { getDashboardSummary } from "@/server/modules/dashboard/service";

export async function GET() {
  try {
    const data = await getDashboardSummary();
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}
