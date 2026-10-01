import ProductInventoryView from "@/components/inventory/ProductInventoryView";

export default function InventoryProductPage({ params }: { params: { id: string } }) {
  return <ProductInventoryView productId={params.id} />;
}
