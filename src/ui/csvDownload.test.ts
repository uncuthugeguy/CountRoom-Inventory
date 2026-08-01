import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from './csvDownload'

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:stockflow')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadCsv', () => {
  it('offers the csv as a named download and cleans the object url up', async () => {
    const clicks: string[] = []
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.download)
      })

    downloadCsv('products.csv', 'Name\r\nWidget')

    expect(click).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual(['products.csv'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stockflow')
  })

  it('writes a utf-8 csv with a byte order mark so spreadsheets read accents correctly', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('products.csv', 'Name\r\nCafé')

    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toContain('text/csv')
    expect(await blob.text()).toBe('﻿Name\r\nCafé')
  })

  it('leaves no anchor behind in the document', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('products.csv', 'Name')

    expect(document.querySelectorAll('a')).toHaveLength(0)
  })
})
