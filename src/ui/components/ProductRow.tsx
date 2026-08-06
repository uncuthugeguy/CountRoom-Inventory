import { isLowStock } from '../../domain/inventory'
import type { MovementType, Product } from '../../domain/types'
import { formatDateTime, formatNumber } from '../format'
import { StockActions } from './StockActions'

export interface ProductRowProps {
  product: Product
  onMove: (product: Product, type: MovementType) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onPrintLabel: (product: Product) => void
}

export function ProductRow({ product, onMove, onEdit, onDelete, onPrintLabel }: ProductRowProps) {
  const low = isLowStock(product)

  return (
    <li className="product-row" data-testid="product-row">
      <div className="product-identity">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-meta">
          <span className="mono">{product.sku}</span>
          {product.barcode && <span className="mono">{product.barcode}</span>}
          {product.category && <span className="chip">{product.category}</span>}
          {product.location && <span className="chip">{product.location}</span>}
          {product.variation && <span className="chip">{product.variation}</span>}
        </p>
        <p className="product-added muted">Added {formatDateTime(product.createdAt)}</p>
      </div>

      <div className="product-quantity">
        <span className={`quantity ${low ? 'quantity-low' : ''}`}>
          {formatNumber(product.quantity)}
        </span>
        <span className="quantity-caption">
          {low ? 'Low — reorder at ' : 'Reorder at '}
          {product.reorderLevel}
        </span>
      </div>

      <div className="product-actions">
        <StockActions product={product} onMove={onMove} />
        <div className="row-admin">
          <button
            type="button"
            className="button button-ghost"
            aria-label={`Print label for ${product.name}`}
            onClick={() => onPrintLabel(product)}
          >
            Print label
          </button>
          <button
            type="button"
            className="button button-ghost"
            aria-label={`Edit ${product.name}`}
            onClick={() => onEdit(product)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button-ghost"
            aria-label={`Delete ${product.name}`}
            onClick={() => onDelete(product)}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  )
}
