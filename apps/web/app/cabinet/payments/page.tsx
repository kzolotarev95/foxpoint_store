import { CabinetRoutePage, type PageSearchParams } from "../cabinet-route-page";

export default async function CabinetPaymentsPage(props: { searchParams: PageSearchParams }) {
  return <CabinetRoutePage activeTab="payments" searchParams={props.searchParams} />;
}
