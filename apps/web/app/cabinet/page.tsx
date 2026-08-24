import { redirect } from "next/navigation";
import type { PageSearchParams } from "./cabinet-route-page";

export default async function CabinetPage(props: { searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const target = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      target.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          target.append(key, item);
        }
      }
    }
  }

  redirect(target.size ? `/cabinet/routers?${target.toString()}` : "/cabinet/routers");
}
