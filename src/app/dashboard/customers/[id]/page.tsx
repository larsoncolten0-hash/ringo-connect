import CustomerProfileView from "@/components/customers/CustomerProfileView";

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  return <CustomerProfileView id={params.id} />;
}
