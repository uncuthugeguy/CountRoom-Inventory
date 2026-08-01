import { MOVEMENT_LABELS, type MovementType, type Product } from '../../domain/types'

export interface StockActionsProps {
  product: Product
  onMove: (product: Product, type: MovementType) => void
}

const SHORT: Record<MovementType, string> = { in: 'In', out: 'Out', adjust: 'Adjust' }
const TYPES: MovementType[] = ['in', 'out', 'adjust']

/**
 * The three stock actions, labelled with the product so a screen reader — and
 * a test — can tell one row's buttons from the next.
 */
export function StockActions({ product, onMove }: StockActionsProps) {
  return (
    <div className="stock-actions">
      {TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={`button button-${type}`}
          aria-label={`${MOVEMENT_LABELS[type]} ${product.name}`}
          onClick={() => onMove(product, type)}
        >
          {SHORT[type]}
        </button>
      ))}
    </div>
  )
}
