import { CabinetRoutePage, type PageSearchParams } from "../cabinet-route-page";

export default async function CabinetRoutersPage(props: { searchParams: PageSearchParams }) {
  return <CabinetRoutePage activeTab="routers" searchParams={props.searchParams} />;
}
