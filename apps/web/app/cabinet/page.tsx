import { CabinetRoutePage, type PageSearchParams } from "./cabinet-route-page";

export default async function CabinetPage(props: { searchParams: PageSearchParams }) {
  return <CabinetRoutePage activeTab="overview" searchParams={props.searchParams} />;
}
