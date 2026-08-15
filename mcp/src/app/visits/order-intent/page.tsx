import { redirect } from "next/navigation";

export default function LegacyOrderIntentRedirectPage() {
  redirect("/orders");
}
