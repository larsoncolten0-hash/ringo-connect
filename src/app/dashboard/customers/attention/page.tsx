import AttentionView from "@/components/customers/AttentionView";
import CustomersTabs from "@/components/customers/CustomersTabs";

export default function CustomersAttentionPage() {
  return (
    <>
      <CustomersTabs />
      <div className="mt-5"><AttentionView /></div>
    </>
  );
}
