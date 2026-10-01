import CustomersTabs from "@/components/customers/CustomersTabs";
import CustomersView from "@/components/customers/CustomersView";

export default function CustomersPage() {
  return (
    <>
      <CustomersTabs />
      <div className="mt-5"><CustomersView /></div>
    </>
  );
}
