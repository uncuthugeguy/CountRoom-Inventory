import type { Product } from '../domain/types'

const AT = '2026-01-06T09:00:00.000Z'

const seed = (
  id: string,
  barcode: string,
  sku: string,
  name: string,
  category: string,
  location: string,
  quantity: number,
  reorderLevel: number,
): Product => ({
  id,
  barcode,
  sku,
  name,
  category,
  location,
  quantity,
  reorderLevel,
  createdAt: AT,
  updatedAt: AT,
})

/** Sample catalogue so a fresh install is immediately explorable offline. */
export const DEMO_PRODUCTS: Product[] = [
  seed('demo-1', '5012345678900', 'BLT-M6-30', 'M6 x 30mm Hex Bolt', 'Fasteners', 'A1', 480, 100),
  seed('demo-2', '5012345678917', 'WSH-M6', 'M6 Flat Washer', 'Fasteners', 'A2', 64, 100),
  seed('demo-3', '5012345678924', 'NUT-M6', 'M6 Nyloc Nut', 'Fasteners', 'A3', 210, 100),
  seed('demo-4', '4006381333931', 'DRL-18V-C', 'Cordless Drill 18V', 'Power Tools', 'B1', 7, 3),
  seed('demo-5', '4006381333948', 'BAT-18V-4A', 'Battery Pack 18V 4Ah', 'Power Tools', 'B2', 2, 4),
  seed('demo-6', '0075678164125', 'TAPE-19', 'Masking Tape 19mm', 'Consumables', 'C1', 35, 12),
  seed('demo-7', '0075678164132', 'GLV-L', 'Nitrile Gloves (L)', 'Consumables', 'C2', 0, 5),
  seed('demo-8', '9780201379624', 'SFT-CAL-01', 'Digital Caliper 150mm', 'Measuring', 'D4', 11, 2),
]
