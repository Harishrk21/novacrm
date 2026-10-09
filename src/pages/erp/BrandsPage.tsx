import { Navigate } from 'react-router-dom'

/** Brands live under Suppliers → Brands tab. */
export function BrandsPage() {
  return <Navigate to="/erp/suppliers?tab=brands" replace />
}
