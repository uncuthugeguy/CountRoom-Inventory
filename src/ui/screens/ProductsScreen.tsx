import { useId, useMemo, useState } from 'react'
import { productsToCsv } from '../../domain/csv'
import { searchProducts } from '../../domain/inventory'
import type { MovementType, Product } from '../../domain/types'
import { ProductRow } from '../components/ProductRow'
import { downloadCsv, timestampedFilename } from '../csvDownload'

export interface ProductsScreenProps {
  products: Product[]
  onMove: (product: Product, type: MovementType) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onCreate: () => void
  onPrintLabel: (product: Product) => void
}

export function ProductsScreen({
  products,
  onMove,
  onEdit,
  onDelete,
  onCreate,
  onPrintLabel,
}: ProductsScreenProps) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const visible = useMemo(() => searchProducts(products, query), [products, query])

  return (
    <div className="screen">
      <div className="toolbar">
        <div className="field field-grow">
          <label htmlFor={searchId}>Search products</label>
          <input
            id={searchId}
            type="search"
            value={query}
            autoComplete="off"
            placeholder="Name, SKU, barcode, category or location"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button type="button" className="button button-primary" onClick={onCreate}>
            New product
          </button>
          <button
            type="button"
            className="button"
            onClick={() => downloadCsv(timestampedFilename('products'), productsToCsv(visible))}
          >
            Export products CSV
          </button>
        </div>
      </div>

      <p className="muted result-count">
        {visible.length} of {products.length} products
      </p>

      {visible.length === 0 ? (
        <p className="empty">
          {products.length === 0
            ? 'No products yet. Add the first one to get started.'
            : 'No products match that search.'}
        </p>
      ) : (
        <ul className="product-list">
          {visible.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onMove={onMove}
              onEdit={onEdit}
              onDelete={onDelete}
              onPrintLabel={onPrintLabel}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
