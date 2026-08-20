import { CabinetRoutePage, type PageSearchParams } from "../cabinet-route-page";

export default async function CabinetProfilePage(props: { searchParams: PageSearchParams }) {
  return <CabinetRoutePage activeTab="profile" searchParams={props.searchParams} />;
}
