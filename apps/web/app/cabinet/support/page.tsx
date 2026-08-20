import { CabinetRoutePage, type PageSearchParams } from "../cabinet-route-page";

export default async function CabinetSupportPage(props: { searchParams: PageSearchParams }) {
  return <CabinetRoutePage activeTab="support" searchParams={props.searchParams} />;
}
